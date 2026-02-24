import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "../..");

const TEAMS_PATH = path.join(ROOT, "src", "data", "leagues", "epl", "2025", "teams.json");

// Use the same base URL + headers you already use in fetch-standings
const BASE_URL = "https://v3.football.api-sports.io";
const API_KEY = process.env.APIFOOTBALL_KEY;

if (!API_KEY) {
  console.error("Missing APIFOOTBALL_KEY env var");
  process.exit(1);
}

async function apiGet(url) {
  const res = await fetch(url, {
    headers: {
      "x-apisports-key": API_KEY,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status} ${res.statusText} for ${url}\n${text}`);
  }
  return res.json();
}

function normalizeVenue(v) {
  if (!v) return null;
  return {
    name: v.name ?? "",
    city: v.city ?? "",
    capacity: v.capacity ?? null,
    surface: v.surface ?? "",
    // image: v.image ?? "",
  };
}

async function main() {
  const teams = JSON.parse(await fs.readFile(TEAMS_PATH, "utf8"));

  for (const [slug, team] of Object.entries(teams)) {
    const id = team.apiTeamId;
    if (!id) throw new Error(`Missing apiTeamId for ${slug}`);

    const url = `${BASE_URL}/teams?id=${encodeURIComponent(id)}`;
    const data = await apiGet(url);

    const row = data?.response?.[0];
    const venue = normalizeVenue(row?.venue);

    if (!venue?.name) {
      console.warn(`No venue returned for ${slug} (apiTeamId=${id})`);
      continue;
    }

    const existing = teams[slug].venue || {};

    teams[slug].venue = {
      ...existing,                 // keep existing image if present
      ...venue,                    // update name/city/capacity/surface from API
      image: existing.image || `/img/venues/${slug}.webp`, // local default
    };

    console.log(`Updated ${slug}: ${teams[slug].venue.name} [img=${teams[slug].venue.image}]`);
  }

  await fs.writeFile(TEAMS_PATH, JSON.stringify(teams, null, 2) + "\n", "utf8");
  console.log("Wrote venues into teams.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});