// src/scripts/build-players-cache.mjs
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "../..");

const SEASON = "2025";
const LEAGUE = "epl";

const MATCHDAYS_DIR = path.join(
  ROOT,
  "public",
  "data",
  "leagues",
  LEAGUE,
  SEASON,
  "matchdays"
);

const PLAYERS_FILE = path.join(
  ROOT,
  "src",
  "data",
  "leagues",
  LEAGUE,
  SEASON,
  "players.json"
);

const API_BASE = "https://v3.football.api-sports.io";
const API_KEY = process.env.APIFOOTBALL_KEY;

  if (!API_KEY) {
  console.error("Missing APIFOOTBALL_KEY (env var not set).");
  process.exit(1);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// Football-style surname normalization:
// - Use first surname token
// - Preserve leading particles (van, de, etc.)
// - Ignore additional family names / middle names

const particles = new Set([
  "de", "da", "di", "dos", "del",
  "van", "von", "der", "den",
  "la", "le", "du"
]);

function normalizeLastName(lastname = "") {
  const parts = lastname.trim().split(/\s+/);
  if (!parts.length) return "";

  // If lastname starts with particle(s), keep all consecutive particles + next token
  if (particles.has(parts[0].toLowerCase())) {
    const out = [];
    let i = 0;

    // collect consecutive particles
    while (i < parts.length && particles.has(parts[i].toLowerCase())) {
      out.push(parts[i].toLowerCase());
      i++;
    }

    // include the first non-particle token (if any)
    if (i < parts.length) out.push(parts[i]);

    return out.join(" ");
  }

  // Otherwise just first surname token
  return parts[0];
}


function normalizeName(firstname = "", lastname = "") {
  const first = firstname.trim().split(/\s+/)[0] || "";
  const last =normalizeLastName(lastname.trim());

  if (first && last) return `${first} ${last}`;
  return first || last || null;
}

function normalizePlayer(profilePlayer) {
  // API returns: player: { id, name, firstname, lastname, ... }
  const p = profilePlayer || {};
  const firstname = (p.firstname || "").trim();
  const lastname = (p.lastname || "").trim();

  // Keep API "name" as display fallback (often "N. Okafor")
  const name = (p.name || "").trim();

  // Title uses firstname + lastname when available
  const full = normalizeName(firstname, lastname);

  return {
    id: p.id,
    name: name || full || String(p.id),
    firstname: firstname || null,
    lastname: lastname || null,
    fullName: full || null
  };
}

async function fetchProfile(playerId) {
  const url = `${API_BASE}/players/profiles?player=${encodeURIComponent(
    playerId
  )}`;

  const res = await fetch(url, {
    headers: { "x-apisports-key": API_KEY }
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Profile fetch failed (${res.status}) for player=${playerId}: ${text.slice(
        0,
        200
      )}`
    );
  }

  const data = await res.json();
  const item = data?.response?.[0];
  const player = item?.player;

  if (!player?.id) return null;
  return normalizePlayer(player);
}

async function listMatchdayFiles() {
  const files = await fs.readdir(MATCHDAYS_DIR);
  return files
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(MATCHDAYS_DIR, f));
}

function collectPlayerIdsFromMatchday(md) {
  const ids = new Set();

  for (const match of md?.matches || []) {
    for (const ev of match?.events || []) {
      if (Number.isFinite(ev?.playerId)) ids.add(ev.playerId);
      if (Number.isFinite(ev?.assistId)) ids.add(ev.assistId);
    }
  }

  return ids;
}

async function loadPlayersMap() {
  if (!(await fileExists(PLAYERS_FILE))) return {};
  const raw = await fs.readFile(PLAYERS_FILE, "utf8");
  const obj = JSON.parse(raw);
  return obj && typeof obj === "object" ? obj : {};
}

async function savePlayersMap(map) {
  await fs.mkdir(path.dirname(PLAYERS_FILE), { recursive: true });

  // Keep keys sorted for diff stability (even if you don't commit, this helps debugging)
  const sorted = Object.fromEntries(
    Object.entries(map).sort((a, b) => Number(a[0]) - Number(b[0]))
  );

  await fs.writeFile(PLAYERS_FILE, JSON.stringify(sorted, null, 2), "utf8");
}

async function main() {
  if (!API_KEY) {
    console.error(
      "Missing API key. Set one of: APIFOOTBALL_KEY, API_FOOTBALL_KEY, API_SPORTS_KEY"
    );
    process.exit(1);
  }

  if (!(await fileExists(MATCHDAYS_DIR))) {
    console.error("Matchdays directory not found:", MATCHDAYS_DIR);
    process.exit(1);
  }

  const files = await listMatchdayFiles();
  if (!files.length) {
    console.log("No matchday files found. Nothing to do.");
    return;
  }

  // 1) Gather all player IDs from matchdays
  const allIds = new Set();
  for (const fp of files) {
    const md = JSON.parse(await fs.readFile(fp, "utf8"));
    const ids = collectPlayerIdsFromMatchday(md);
    for (const id of ids) allIds.add(id);
  }

  console.log(`Found ${allIds.size} unique player IDs in matchdays.`);

  // 2) Load existing players map
  const players = await loadPlayersMap();
  const have = new Set(Object.keys(players).map((k) => Number(k)));

  // 3) Determine missing
  const missing = [...allIds].filter((id) => !have.has(id));
  console.log(`Players already cached: ${have.size}`);
  console.log(`Players missing: ${missing.length}`);

  if (!missing.length) {
    console.log("No missing players. Done.");
    return;
  }

  // 4) Fetch missing profiles with gentle throttling
  // Keep it simple: sequential + small delay (low risk of rate limits)
  let ok = 0;
  let fail = 0;

  for (const id of missing) {
    try {
      const prof = await fetchProfile(id);
      if (prof) {
        players[String(id)] = prof;
        ok++;
      } else {
        // Cache a minimal stub so we don't refetch forever
        players[String(id)] = { id, name: String(id), firstname: null, lastname: null, fullName: null };
        ok++;
      }
    } catch (e) {
      fail++;
      console.warn(`Failed profile for ${id}: ${e.message}`);
      // Don't cache failures; we want to retry next run
    }

    // small delay keeps API happy
    await sleep(50);
  }

  await savePlayersMap(players);

  console.log(`Profiles fetched OK: ${ok}, failed: ${fail}`);
  console.log(`Wrote players cache: ${PLAYERS_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});