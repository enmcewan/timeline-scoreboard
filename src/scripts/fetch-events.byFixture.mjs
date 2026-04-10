import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import fixturesRaw from "../../public/data/leagues/epl/2025-26/fixtures.raw.json" with { type: "json" };

import { parseMatchweekNumber, getForcedRefreshRounds } from "../lib/utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_KEY = process.env.APIFOOTBALL_KEY;
const BASE_URL = "https://v3.football.api-sports.io";

const OUT_PATH = path.join(__dirname, "../../public/data/leagues/epl/2025-26/events.raw.json");

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

// function parseMatchweekNumber(round) {
//   if (!round) return null;
//   const m = String(round).match(/(\d+)\s*$/);
//   return m ? Number(m[1]) : null;
// }

function getCurrentRound(fixtures) {
  const rounds = fixtures
    .map((fx) => parseMatchweekNumber(fx?.league?.round))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (!rounds.length) return null;

  const completedStates = new Set(["FT", "AET", "PEN"]);

  for (const round of [...new Set(rounds)]) {
    const roundFixtures = fixtures.filter(
      (fx) => parseMatchweekNumber(fx?.league?.round) === round
    );

    if (!roundFixtures.length) continue;

    const hasIncomplete = roundFixtures.some((fx) => {
      const s = String(fx?.fixture?.status?.short ?? "").toUpperCase();
      return !completedStates.has(s);
    });

    if (hasIncomplete) return round;
  }

  return rounds[rounds.length - 1];
}

// function shouldFetchFixture(fx, existingFixtureIds, forcedRounds) {
//   const fixtureId = String(fx.fixture?.id);
//   if (!fixtureId) return false;

//   const md = parseMatchdayNumber(fx?.league?.round);

//   // Always refresh current + previous round
//   if (md && forcedRounds.has(md)) return true;

//   // Otherwise fetch only if missing
//   return !existingFixtureIds.has(fixtureId);
// }

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

  const fixtures = fixturesRaw.response || [];

  const existingEvents = await readExistingEventsFile();

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

  // const currentRound = getCurrentRound(fixtures);
  // const previousRound = currentRound && currentRound > 1 ? currentRound - 1 : currentRound;
  // const forcedRounds = new Set([previousRound, currentRound].filter(Number.isFinite));

  // console.log(`Fixtures total: ${fixtures.length}`);
  // console.log(`Fixtures already cached: ${existingFixtureIds.size}`);
  // console.log(`Always refresh rounds: ${[...forcedRounds].sort((a, b) => a - b).join(", ")}`);

  const forcedRounds = getForcedRefreshRounds(fixtures);

  console.log(`Fixtures total: ${fixtures.length}`);
  console.log(`Fixtures already cached: ${existingFixtureIds.size}`);
  console.log(`Always refresh rounds: ${[...forcedRounds].sort((a, b) => a - b).join(", ")}`);

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