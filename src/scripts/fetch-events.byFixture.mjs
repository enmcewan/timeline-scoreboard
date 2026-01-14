import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import fixturesRaw from "../data/dev/fixtures.raw.json" with { type: "json" };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_KEY = "REMOVED"; // same as before"";
const BASE_URL = "https://v3.football.api-sports.io";

const OUT_PATH = path.join(__dirname, "../data/dev/events.raw.json");

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
    `fixture ${fixtureId} → results: ${json.results}, response length: ${
      json.response?.length ?? 0
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
  const allEvents = [];

  console.log(`Fetching events for ${fixtures.length} fixtures...`);

  for (const fx of fixtures) {
    const fixtureId = fx.fixture.id;
    const homeName = fx.teams.home.name;
    const awayName = fx.teams.away.name;

    console.log(`→ ${fixtureId}: ${homeName} vs ${awayName}`);

    const events = await fetchEventsForFixture(fixtureId);

    for (const e of events) {
      // 🔑 attach fixtureId so we can group later
      allEvents.push({
        fixtureId,
        ...e
      });
    }

    // small delay to be nice to the API
    await new Promise((r) => setTimeout(r, 50));
  }

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
