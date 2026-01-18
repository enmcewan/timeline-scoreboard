import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import fixturesRaw from "../data/dev/fixtures.raw.json" with { type: "json" };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_KEY = "REMOVED"; // same as before"";
const BASE_URL = "https://v3.football.api-sports.io";

const OUT_PATH = path.join(__dirname, "../data/dev/events.raw.json");

const REFRESH_WINDOW_HOURS = 24;
const REFRESH_WINDOW_MS = REFRESH_WINDOW_HOURS * 60 * 60 * 1000;

const UPCOMING_WINDOW_HOURS = 6;
const UPCOMING_WINDOW_MS = UPCOMING_WINDOW_HOURS * 60 * 60 * 1000;


async function readExistingEventsFile() {
  try {
    const txt = await fs.readFile(OUT_PATH, "utf8");
    const json = JSON.parse(txt);
    return Array.isArray(json?.response) ? json.response : [];
  } catch {
    return []; // no file yet
  }
}

function kickoffMs(fx) {
  const t = Date.parse(fx?.fixture?.date);
  return Number.isFinite(t) ? t : NaN;
}

function shouldFetchFixture(fx, existingFixtureIds) {
  const fixtureId = String(fx.fixture?.id);
  if (!fixtureId) return false;

  // If we don't already have any events for this fixture, fetch.
  if (!existingFixtureIds.has(fixtureId)) return true;

  // If it's recent, refetch to catch late corrections.
  const ko = kickoffMs(fx);
  if (Number.isFinite(ko)) {
    const age = Date.now() - ko;
    if (age >= 0 && age < REFRESH_WINDOW_MS) return true;
  }

  // Otherwise it's frozen, skip.
  return false;
}

async function fetchEventsForFixture(fixtureId) {
  const url = `${BASE_URL}/fixtures/events?fixture=${fixtureId}`;

  const res = await fetch(url, {
    headers: {
      "x-apisports-key": API_KEY
    }
  });

  if (!res.ok) {
    throw new Error(
      `Events fetch failed for fixture ${fixtureId}: ${res.status} ${res.statusText}`
    );
  }

  const json = await res.json();

  if (json.errors && Object.keys(json.errors).length) {
    console.warn("API errors for fixture", fixtureId, json.errors);
  }

  console.log(
    `fixture ${fixtureId} → results: ${json.results}, response length: ${json.response?.length ?? 0
    }`
  );

  return json.response || [];
}

async function main() {
  if (!API_KEY) {
    console.error("Missing APIFOOTBALL_KEY env var (APIFOOTBALL_KEY)");
    process.exit(1);
  }

  const fixtures = fixturesRaw.response || [];

  // Load existing events file (if any)
  const existingEvents = await readExistingEventsFile();

  // Index: which fixtureIds already exist in the file
  const existingFixtureIds = new Set(
    existingEvents
      .map((e) => String(e.fixtureId ?? ""))
      .filter(Boolean)
  );

  // Group existing events by fixture so we can replace per fixture
  const eventsByFixture = new Map(); // fixtureId -> [events...]
  for (const e of existingEvents) {
    const fid = String(e.fixtureId ?? "");
    if (!fid) continue;
    if (!eventsByFixture.has(fid)) eventsByFixture.set(fid, []);
    eventsByFixture.get(fid).push(e);
  }

  console.log(`Fixtures total: ${fixtures.length}`);
  console.log(`Fixtures already cached: ${existingFixtureIds.size}`);
  console.log(`Incremental fetch (refresh window: ${REFRESH_WINDOW_HOURS}h)`);

  let fetchedFixtures = 0;

  for (const fx of fixtures) {
    const fixtureId = String(fx.fixture?.id);
    if (!fixtureId) continue;

    const ko = Date.parse(fx?.fixture?.date);
    if (Number.isFinite(ko)) {
      const now = Date.now();
      if (ko > now + UPCOMING_WINDOW_MS) {
        // too far in the future
        continue;
      }
    }

    const homeName = fx.teams?.home?.name ?? "";
    const awayName = fx.teams?.away?.name ?? "";

    if (!shouldFetchFixture(fx, existingFixtureIds)) {
      continue;
    }

    console.log(`→ FETCH ${fixtureId}: ${homeName} vs ${awayName}`);

    const events = await fetchEventsForFixture(fixtureId);

    // Replace this fixture's events in the map
    const merged = (events || []).map((e) => ({ fixtureId, ...e }));
    eventsByFixture.set(fixtureId, merged);

    fetchedFixtures++;
    await new Promise((r) => setTimeout(r, 50));
  }

  // Flatten back to your original format
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
  console.log(`Wrote ${allEvents.length} events to ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
