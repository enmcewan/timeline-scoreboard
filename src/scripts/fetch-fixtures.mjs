import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API_KEY = process.env.APIFOOTBALL_KEY;
const LEAGUE = 39;
const SEASON = 2025;
const DATAPATH = "/public/data/leagues/epl/2025-26/";

if (!API_KEY) {
  console.error("Missing APIFOOTBALL_KEY env var (APIFOOTBALL_KEY)");
  process.exit(1);
}

// --- resolve project root paths ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");

function writeJson(relativePath, data) {
  const full = path.join(projectRoot, relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(data, null, 2), "utf8");
  console.log(`Wrote: ${full}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isTransientApiError(err) {
  const msg = String(err?.message || err);
  return (
    msg.includes("503") ||
    msg.includes("502") ||
    msg.includes("504") ||
    msg.includes("429") ||
    msg.toLowerCase().includes("timeout") ||
    msg.toLowerCase().includes("econnreset") ||
    msg.toLowerCase().includes("socket hang up")
  );
}

async function fetchWithRetry(fn, { tries = 5, baseDelayMs = 750 } = {}) {
  let lastErr;

  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransientApiError(err) || attempt === tries) throw err;

      const jitter = Math.floor(Math.random() * 250);
      const delay = baseDelayMs * Math.pow(2, attempt - 1) + jitter;

      console.warn(
        `Transient API error (attempt ${attempt}/${tries}): ${String(err?.message || err)}`
      );
      console.warn(`Retrying in ${delay}ms...`);

      await sleep(delay);
    }
  }

  throw lastErr;
}

function validateApiPayload(json) {
  if (json?.errors && Object.keys(json.errors).length) {
    const msg = Object.entries(json.errors)
      .map(([k, v]) => `${k}: ${v}`)
      .join(" | ");

    throw new Error(`API returned error payload: ${msg}`);
  }

  if (!Array.isArray(json?.response)) {
    throw new Error("API returned no response array.");
  }
}

async function fetchJson(url) {
  console.log(`Fetching: ${url}`);

  const res = await fetch(url, {
    headers: {
      "x-apisports-key": API_KEY,
    },
  });

  console.log("HTTP status:", res.status);

  const body = await res.text();

  if (!res.ok) {
    console.error("Error response body:\n", body);
    throw new Error(`HTTP ${res.status} from ${url}`);
  }

  let json;

  try {
    json = JSON.parse(body);
  } catch (e) {
    console.error("Failed to parse JSON body:\n", body);
    throw e;
  }

  validateApiPayload(json);
  return json;
}

function getKickoffMs(fx) {
  if (fx?.fixture?.timestamp) return Number(fx.fixture.timestamp) * 1000;

  const iso = fx?.fixture?.date;
  const t = iso ? Date.parse(iso) : NaN;

  return Number.isFinite(t) ? t : NaN;
}

function getStatusShort(fx) {
  return String(fx?.fixture?.status?.short ?? "").toUpperCase();
}

function shouldPatchFixtureById(fx, nowMs = Date.now()) {
  const status = getStatusShort(fx);
  const kickoffMs = getKickoffMs(fx);

  if (!Number.isFinite(kickoffMs)) return false;

  // These are the statuses most likely to be stale on the broad season endpoint.
  const STALE_CANDIDATE = new Set(["NS", "TBD"]);

  if (!STALE_CANDIDATE.has(status)) return false;

  const PRE_MS = 10 * 60 * 1000;

  // Repair stale season-endpoint data for recently played fixtures.
  // This needs to be much wider than the live refresh window because
  // GitHub/API delays may leave fixture.raw stuck on NS after FT.
  const STALE_REPAIR_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

  return (
    nowMs >= kickoffMs - PRE_MS &&
    nowMs <= kickoffMs + STALE_REPAIR_LOOKBACK_MS
  );
}

async function fetchFixtureById(fixtureId) {
  const url = `https://v3.football.api-sports.io/fixtures?id=${encodeURIComponent(fixtureId)}`;

  const json = await fetchWithRetry(
    () => fetchJson(url),
    { tries: 5, baseDelayMs: 750 }
  );

  return json.response?.[0] ?? null;
}

function describeFixture(fx) {
  return [
    fx?.fixture?.id,
    fx?.league?.round,
    fx?.fixture?.date,
    `${fx?.teams?.home?.name ?? "?"} vs ${fx?.teams?.away?.name ?? "?"}`,
    `status=${fx?.fixture?.status?.short ?? "?"}`,
    `score=${fx?.goals?.home ?? "-"}-${fx?.goals?.away ?? "-"}`,
  ].join(" | ");
}

async function patchStaleNearNowFixtures(data) {
  const fixtures = data.response ?? [];
  const nowMs = Date.now();

  const candidates = fixtures.filter((fx) => shouldPatchFixtureById(fx, nowMs));

  console.log(`Near-now stale fixture candidates: ${candidates.length}`);

  if (!candidates.length) return data;

  for (const fx of candidates) {
    console.log(`Candidate: ${describeFixture(fx)}`);
  }

  const byId = new Map(
    fixtures
      .map((fx) => [String(fx?.fixture?.id ?? ""), fx])
      .filter(([id]) => Boolean(id))
  );

  let patched = 0;

  for (const fx of candidates) {
    const fixtureId = String(fx?.fixture?.id ?? "");
    if (!fixtureId) continue;

    try {
      const fresh = await fetchFixtureById(fixtureId);

      if (!fresh) {
        console.warn(`No fixture returned for id=${fixtureId}; keeping season fixture.`);
        continue;
      }

      const oldStatus = fx?.fixture?.status?.short ?? "?";
      const newStatus = fresh?.fixture?.status?.short ?? "?";

      const oldScore = `${fx?.goals?.home ?? "-"}-${fx?.goals?.away ?? "-"}`;
      const newScore = `${fresh?.goals?.home ?? "-"}-${fresh?.goals?.away ?? "-"}`;

      console.log(
        `Patch fixture ${fixtureId}: ${oldStatus} ${oldScore} → ${newStatus} ${newScore}`
      );

      byId.set(fixtureId, fresh);
      patched++;
    } catch (err) {
      console.warn(
        `Failed to patch fixture ${fixtureId}; keeping season fixture. ${String(err?.message || err)}`
      );
    }

    await sleep(150);
  }

  data.response = fixtures.map((fx) => {
    const fixtureId = String(fx?.fixture?.id ?? "");
    return byId.get(fixtureId) ?? fx;
  });

  console.log(`Patched fixtures by id: ${patched}/${candidates.length}`);

  return data;
}

async function main() {
  const fixturesUrl = `https://v3.football.api-sports.io/fixtures?league=${LEAGUE}&season=${SEASON}`;

  const data = await fetchWithRetry(
    () => fetchJson(fixturesUrl),
    { tries: 5, baseDelayMs: 750 }
  );

  await patchStaleNearNowFixtures(data);

  writeJson(`${DATAPATH}fixtures.raw.json`, data);

  console.log("Done.");
}

main().catch((err) => {
  console.error("Script error:", err);
  process.exit(1);
});