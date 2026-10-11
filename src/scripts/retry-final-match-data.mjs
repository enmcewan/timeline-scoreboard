import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { getSeasonConfigFromEnv } from "../config/seasons.js";
import {
  applyTheStatsApiMatchData,
  createTheStatsApiXgClient,
} from "./the-stats-api-xg.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "../..");
const RETRY_INTERVAL_MS = 30 * 60 * 1000;
const RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;
const FINISHED_STATES = new Set(["FT", "AET", "PEN"]);

async function readJson(filePath, fallback = null) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function kickoffMs(fixture) {
  const timestamp = Number(fixture?.fixture?.timestamp);
  if (Number.isFinite(timestamp) && timestamp > 0) return timestamp * 1000;
  return Date.parse(fixture?.fixture?.date || "");
}

function hasInsights(match) {
  return Object.keys(match?.insights || {}).length > 0;
}

function hasShotMap(match) {
  return Array.isArray(match?.shotMap?.shots) && match.shotMap.shots.length > 0;
}

function enrichmentSnapshot(match) {
  return JSON.stringify({
    insights: match?.insights || null,
    shotMap: match?.shotMap || null,
  });
}

export async function retryFinalMatchData({ nowMs = Date.now(), root = ROOT } = {}) {
  if (!process.env.TSAPI_KEY) {
    console.warn("Missing TSAPI_KEY; late final match-data retry skipped.");
    return { attempted: 0, updated: 0 };
  }

  const season = getSeasonConfigFromEnv();
  const seasonDataDir = path.join(
    root,
    "public",
    "data",
    "leagues",
    season.leagueKey,
    season.seasonPath
  );
  const fixturesPath = path.join(seasonDataDir, "fixtures.raw.json");
  const matchweeksDir = path.join(seasonDataDir, "matchweeks");
  const cachePath = path.join(seasonDataDir, "thestatsapi-xg.json");
  const teamsPath = path.join(
    root,
    "src",
    "data",
    "leagues",
    season.leagueKey,
    season.sourceDataSeason,
    "teams.json"
  );

  const [fixturesJson, teams, initialCache] = await Promise.all([
    readJson(fixturesPath, { response: [] }),
    readJson(teamsPath, {}),
    readJson(cachePath, { fixtures: {} }),
  ]);
  const fixturesById = new Map(
    (fixturesJson?.response || []).map((fixture) => [String(fixture?.fixture?.id), fixture])
  );
  const files = (await fs.readdir(matchweeksDir))
    .filter((file) => /^\d+\.json$/.test(file))
    .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
  const client = await createTheStatsApiXgClient({
    competitionId: season.theStatsApiCompetitionId,
    seasonId: season.theStatsApiSeasonId,
    seasonPath: season.seasonPath,
    cachePath,
    teams,
  });

  const attemptedIds = [];
  let updated = 0;

  for (const file of files) {
    const filePath = path.join(matchweeksDir, file);
    const matchweek = await readJson(filePath, { matches: [] });
    let touched = false;

    for (const match of matchweek.matches || []) {
      if (hasInsights(match) && hasShotMap(match)) continue;

      const fixtureId = String(match?.id || "");
      const fixture = fixturesById.get(fixtureId);
      const status = String(fixture?.fixture?.status?.short || "").toUpperCase();
      if (!fixture || !FINISHED_STATES.has(status)) continue;

      const kickoff = kickoffMs(fixture);
      const ageMs = nowMs - kickoff;
      if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > RETRY_WINDOW_MS) continue;

      const lastAttempt = Date.parse(
        initialCache?.fixtures?.[fixtureId]?.finalRetryAt || ""
      );
      if (Number.isFinite(lastAttempt) && nowMs - lastAttempt < RETRY_INTERVAL_MS) continue;

      attemptedIds.push(fixtureId);
      const before = enrichmentSnapshot(match);
      const data = await client.getMatchData(fixture, { force: true, final: true });
      applyTheStatsApiMatchData(match, data);

      if (enrichmentSnapshot(match) !== before) {
        touched = true;
        updated++;
      }
    }

    if (touched) await writeJson(filePath, matchweek);
  }

  await client.save();

  if (attemptedIds.length) {
    const cache = await readJson(cachePath, { fixtures: {} });
    cache.fixtures ||= {};
    const attemptedAt = new Date(nowMs).toISOString();
    for (const fixtureId of attemptedIds) {
      cache.fixtures[fixtureId] = {
        ...(cache.fixtures[fixtureId] || {}),
        finalRetryAt: attemptedAt,
      };
    }
    await writeJson(cachePath, cache);
  }

  console.log(
    `Late final match-data retry: ${attemptedIds.length} attempted, ${updated} updated.`
  );
  return { attempted: attemptedIds.length, updated };
}

async function main() {
  await retryFinalMatchData();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
