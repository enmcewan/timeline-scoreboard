import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getSeasonConfigFromEnv } from "../config/seasons.js";
import {
  applyTheStatsApiXg,
  createTheStatsApiXgClient,
} from "./the-stats-api-xg.mjs";

const season = getSeasonConfigFromEnv();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "../..");
const SEASON_DATA_DIR = path.join(
  ROOT,
  "public",
  "data",
  "leagues",
  season.leagueKey,
  season.seasonPath
);
const FIXTURES_RAW_PATH = path.join(SEASON_DATA_DIR, "fixtures.raw.json");
const MATCHWEEKS_DIR = path.join(SEASON_DATA_DIR, "matchweeks");
const XG_CACHE_PATH = path.join(SEASON_DATA_DIR, "thestatsapi-xg.json");
const TEAMS_PATH = path.join(
  ROOT,
  "src",
  "data",
  "leagues",
  season.leagueKey,
  season.sourceDataSeason,
  "teams.json"
);

if (!process.env.TSAPI_KEY) {
  console.error("Missing TSAPI_KEY env var.");
  process.exit(1);
}

async function readJson(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  return JSON.parse(text.replace(/^\uFEFF/, ""));
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  console.log(`Wrote: ${filePath}`);
}

function isStarted(match) {
  const state = String(match?.status?.state || "").toUpperCase();
  if (state && !["NS", "TBD", "PST"].includes(state)) return true;
  const kickoff = Date.parse(match?.kickoff || "");
  return Number.isFinite(kickoff) && kickoff <= Date.now();
}

function xgSnapshot(match) {
  return JSON.stringify({
    home: match?.statistics?.home?.xg ?? null,
    away: match?.statistics?.away?.xg ?? null,
    provider: match?.statistics?.xgProvider ?? null,
  });
}

async function main() {
  const [fixturesJson, teamsJson] = await Promise.all([
    readJson(FIXTURES_RAW_PATH),
    readJson(TEAMS_PATH),
  ]);
  const fixturesById = new Map(
    (fixturesJson?.response || []).map((fixture) => [String(fixture?.fixture?.id), fixture])
  );
  const client = await createTheStatsApiXgClient({
    competitionId: season.theStatsApiCompetitionId,
    seasonId: season.theStatsApiSeasonId,
    seasonPath: season.seasonPath,
    cachePath: XG_CACHE_PATH,
    teams: teamsJson,
  });

  const files = (await fs.readdir(MATCHWEEKS_DIR))
    .filter((file) => /^\d+\.json$/.test(file))
    .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));

  let candidates = 0;
  let updated = 0;
  let unavailable = 0;
  const touchedFiles = [];

  for (const file of files) {
    const filePath = path.join(MATCHWEEKS_DIR, file);
    const matchweek = await readJson(filePath);
    let touched = false;

    for (const match of matchweek.matches || []) {
      if (!isStarted(match)) continue;
      const rawFixture = fixturesById.get(String(match.id));
      if (!rawFixture) {
        console.warn(`Skipping ${match.id}: raw fixture not found.`);
        continue;
      }

      candidates++;
      const before = xgSnapshot(match);
      const xg = await client.getXg(rawFixture, { force: true, final: true });
      if (!applyTheStatsApiXg(match, xg)) {
        unavailable++;
        continue;
      }

      if (xgSnapshot(match) !== before) {
        touched = true;
        updated++;
      }
    }

    if (touched) {
      await writeJson(filePath, matchweek);
      touchedFiles.push(file);
    }
  }

  await client.save();
  console.log(
    `Done. Candidates: ${candidates}. Updated: ${updated}. xG unavailable: ${unavailable}. Files touched: ${touchedFiles.join(", ") || "none"}.`
  );
}

main().catch((error) => {
  console.error("Script error:", error);
  process.exit(1);
});
