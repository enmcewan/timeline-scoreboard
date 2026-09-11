import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getSeasonConfigFromEnv } from "../config/seasons.js";
import { parseMatchweekNumber, getForcedRefreshRounds } from "../lib/utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_KEY = process.env.APIFOOTBALL_KEY;
const BASE_URL = "https://v3.football.api-sports.io";
const season = getSeasonConfigFromEnv();

const SEASON_DATA_DIR = path.join(
  __dirname,
  "../../public/data/leagues",
  season.leagueKey,
  season.seasonPath
);
const FIXTURES_PATH = path.join(SEASON_DATA_DIR, "fixtures.raw.json");
const OUT_PATH = path.join(SEASON_DATA_DIR, "events.raw.json");
const MATCHWEEKS_DIR = path.join(SEASON_DATA_DIR, "matchweeks");

const UPCOMING_WINDOW_HOURS = 6;
const UPCOMING_WINDOW_MS = UPCOMING_WINDOW_HOURS * 60 * 60 * 1000;

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

async function readExistingEventsFile() {
  try {
    const txt = await fs.readFile(OUT_PATH, "utf8");
    const json = JSON.parse(txt);
    return Array.isArray(json?.response) ? json.response : [];
  } catch {
    return [];
  }
}

async function readExistingMatchesByFixtureId() {
  const byFixtureId = new Map();

  try {
    const files = await fs.readdir(MATCHWEEKS_DIR);
    for (const file of files) {
      if (!/^\d+\.json$/.test(file)) continue;

      const txt = await fs.readFile(path.join(MATCHWEEKS_DIR, file), "utf8");
      const json = JSON.parse(txt.replace(/^\uFEFF/, ""));

      for (const match of json?.matches || []) {
        byFixtureId.set(String(match.id), match);
      }
    }
  } catch {
    // no existing matchweek cache yet
  }

  return byFixtureId;
}

function isCompletedStatus(status) {
  return new Set(["FT", "AET", "PEN"]).has(String(status || "").toUpperCase());
}

function fixtureScore(fx) {
  return {
    home: Number(fx?.goals?.home ?? 0),
    away: Number(fx?.goals?.away ?? 0),
  };
}

function matchScore(match) {
  return {
    home: Number(match?.score?.home ?? 0),
    away: Number(match?.score?.away ?? 0),
  };
}

function getIncompleteStartedRounds(fixtures, existingMatchesByFixtureId) {
  const rounds = new Set();
  const staleFixtures = [];

  for (const fx of fixtures) {
    const fixtureId = String(fx?.fixture?.id ?? "");
    const round = parseMatchweekNumber(fx?.league?.round);
    if (!fixtureId || !Number.isFinite(round)) continue;

    const apiStatus = String(fx?.fixture?.status?.short ?? "").toUpperCase();
    if (!isCompletedStatus(apiStatus)) continue;

    const existing = existingMatchesByFixtureId.get(fixtureId);
    const apiScore = fixtureScore(fx);
    const localScore = matchScore(existing);
    const localStatus = String(existing?.status?.state ?? "").toUpperCase();

    const isStale =
      !existing ||
      !isCompletedStatus(localStatus) ||
      localScore.home !== apiScore.home ||
      localScore.away !== apiScore.away ||
      !Array.isArray(existing?.events) ||
      existing.events.length === 0;

    if (!isStale) continue;

    rounds.add(round);
    staleFixtures.push(
      `${fixtureId} [MW ${round}] ${localStatus || "missing"} ${localScore.home}-${localScore.away} -> ${apiStatus} ${apiScore.home}-${apiScore.away}`
    );
  }

  if (staleFixtures.length) {
    console.log(
      "Stale completed fixtures found; forcing rounds:",
      [...rounds].sort((a, b) => a - b)
    );
    for (const line of staleFixtures) console.log(`  ${line}`);
  }

  return rounds;
}

function shouldFetchFixture(fx, existingFixtureIds, forcedRounds) {
  const fixtureId = String(fx.fixture?.id ?? "");
  if (!fixtureId) return false;

  const round = parseMatchweekNumber(fx?.league?.round);

  // Refresh fixtures in any round currently marked for forced refresh.
  if (Number.isFinite(round) && forcedRounds.has(round)) {
    return true;
  }

  // Otherwise only fetch fixtures that are not already cached.
  return !existingFixtureIds.has(fixtureId);
}

async function fetchEventsForFixture(fixtureId) {
  const url = `${BASE_URL}/fixtures/events?fixture=${fixtureId}`;

  const res = await fetch(url, {
    headers: {
      "x-apisports-key": API_KEY
    }
  });

  if (!res.ok) {
    let body = "";
    try { body = await res.text(); } catch { }
    throw new Error(
      `Events fetch failed for fixture ${fixtureId}: ${res.status} ${res.statusText}${body ? ` | ${body.slice(0, 200)}` : ""}`
    );
  }

  const json = await res.json();

  if (json.errors && Object.keys(json.errors).length) {
    console.warn("API errors for fixture", fixtureId, json.errors);
  }

  console.log(
    `fixture ${fixtureId} → results: ${json.results}, response length: ${json.response?.length ?? 0}`
  );

  return json.response || [];
}

async function main() {
  if (!API_KEY) {
    console.error("Missing APIFOOTBALL_KEY env var (APIFOOTBALL_KEY)");
    process.exit(1);
  }

  const fixturesRaw = JSON.parse(await fs.readFile(FIXTURES_PATH, "utf8"));
  const fixtures = fixturesRaw.response || [];

  const existingEvents = await readExistingEventsFile();
  const existingMatchesByFixtureId = await readExistingMatchesByFixtureId();

  const existingFixtureIds = new Set(
    existingEvents
      .map((e) => String(e.fixtureId ?? ""))
      .filter(Boolean)
  );

  const eventsByFixture = new Map();
  for (const e of existingEvents) {
    const fid = String(e.fixtureId ?? "");
    if (!fid) continue;
    if (!eventsByFixture.has(fid)) eventsByFixture.set(fid, []);
    eventsByFixture.get(fid).push(e);
  }

  const forcedRounds = getForcedRefreshRounds(fixtures);
  for (const round of getIncompleteStartedRounds(fixtures, existingMatchesByFixtureId)) {
    forcedRounds.add(round);
  }
  console.log(
    "Final event refresh rounds:",
    [...forcedRounds].sort((a, b) => a - b)
  );

  // console.log(`Fixtures total: ${fixtures.length}`);
  // console.log(`Fixtures already cached: ${existingFixtureIds.size}`);
  // console.log(`Always refresh rounds: ${[...forcedRounds].sort((a, b) => a - b).join(", ")}`);

  let fetchedFixtures = 0;

  for (const fx of fixtures) {
    const fixtureId = String(fx.fixture?.id);
    if (!fixtureId) continue;

    const ko = Date.parse(fx?.fixture?.date);
    if (Number.isFinite(ko)) {
      const now = Date.now();
      if (ko > now + UPCOMING_WINDOW_MS) {
        continue;
      }
    }

    const homeName = fx.teams?.home?.name ?? "";
    const awayName = fx.teams?.away?.name ?? "";
    const md = parseMatchweekNumber(fx?.league?.round);

    if (!shouldFetchFixture(fx, existingFixtureIds, forcedRounds)) {
      continue;
    }

    console.log(`→ FETCH ${fixtureId} [MW ${md}]: ${homeName} vs ${awayName}`);

    let events = null;

    try {
      events = await fetchWithRetry(
        () => fetchEventsForFixture(fixtureId),
        { tries: 5, baseDelayMs: 750 }
      );
    } catch (err) {
      console.error(
        `SKIP ${fixtureId} (${homeName} vs ${awayName}) after retries: ${String(err?.message || err)}`
      );
      continue;
    }

    const merged = (events || []).map((e) => ({ fixtureId, ...e }));
    eventsByFixture.set(fixtureId, merged);

    fetchedFixtures++;
    await sleep(150);
  }

  const allEvents = Array.from(eventsByFixture.values()).flat();

  const outJson = {
    get: "fixtures/events",
    parameters: {
      season: fixtures[0]?.league?.season ?? null,
      league: fixtures[0]?.league?.id ?? null
    },
    errors: [],
    results: allEvents.length,
    paging: { current: 1, total: 1 },
    response: allEvents
  };

  await fs.writeFile(OUT_PATH, JSON.stringify(outJson, null, 2), "utf8");
  console.log(`Fetched fixtures this run: ${fetchedFixtures}`);
  console.log(`Wrote ${allEvents.length} events to ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
