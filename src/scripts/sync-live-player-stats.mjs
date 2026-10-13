import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getSeasonConfigFromEnv } from "../config/seasons.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");
const season = getSeasonConfigFromEnv();
const seasonDataDir = path.join(
  projectRoot,
  "public",
  "data",
  "leagues",
  season.leagueKey,
  season.seasonPath,
);
const outputPath = path.join(seasonDataDir, "player-stats.json");
const fixturesPath = path.join(seasonDataDir, "fixtures.raw.json");
const matchCachePath = path.join(seasonDataDir, "thestatsapi-xg.json");
const playerMatchDir = path.join(seasonDataDir, "player-stats", "matches");
const liveBaseUrl =
  process.env.LIVE_SEASON_DATA_URL ||
  process.env.LIVE_SITE_DATA_URL ||
  `https://timelinefootball.com/data/leagues/${season.leagueKey}/${season.seasonPath}`;

function parseJson(text, label) {
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error(`${label} did not return valid JSON`);
  }
}

function isPlayerStats(value) {
  return (
    value &&
    String(value.source || "").includes("thestatsapi") &&
    value.seasonPath === season.seasonPath &&
    Array.isArray(value.players)
  );
}

function isMatchCache(value, fixtureId) {
  return (
    String(value?.fixtureId || "") === String(fixtureId) &&
    Array.isArray(value?.players)
  );
}

function isTheStatsApiCache(value) {
  return value && value.source === "thestatsapi" && value.fixtures && typeof value.fixtures === "object";
}

function timestamp(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

async function main() {
  let liveStats;
  try {
    const response = await fetch(`${liveBaseUrl}/player-stats.json`, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    liveStats = parseJson(await response.text(), "Deployed player stats");
    if (!isPlayerStats(liveStats)) throw new Error("unexpected data shape");
  } catch (error) {
    console.warn(`Could not synchronize deployed player stats: ${error.message}`);
    console.warn("Keeping the local player-stat aggregate unchanged.");
    return;
  }

  const localStats = parseJson(
    await fs.readFile(outputPath, "utf8").catch(() => "null"),
    "Local player stats",
  );
  if (isPlayerStats(localStats) && timestamp(localStats.updatedAt) >= timestamp(liveStats.updatedAt)) {
    console.log("Local player stats are already as recent as the deployed aggregate.");
  } else {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(liveStats, null, 2)}\n`, "utf8");
    console.log(
      `Hydrated player stats: ${liveStats.players.length} players from ${liveStats.matchesIncluded || 0} matches.`,
    );
  }

  try {
    const response = await fetch(`${liveBaseUrl}/thestatsapi-xg.json`, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const liveMatchCache = parseJson(await response.text(), "Deployed TSAPI match cache");
    if (!isTheStatsApiCache(liveMatchCache)) throw new Error("unexpected data shape");
    const localMatchCache = parseJson(
      await fs.readFile(matchCachePath, "utf8").catch(() => "null"),
      "Local TSAPI match cache",
    );
    if (
      !isTheStatsApiCache(localMatchCache) ||
      timestamp(liveMatchCache.updatedAt) > timestamp(localMatchCache.updatedAt)
    ) {
      await fs.writeFile(matchCachePath, `${JSON.stringify(liveMatchCache, null, 2)}\n`, "utf8");
      console.log(`Hydrated TSAPI match cache: ${Object.keys(liveMatchCache.fixtures).length} fixtures.`);
    }
  } catch (error) {
    console.warn(`Could not synchronize deployed TSAPI match cache: ${error.message}`);
  }

  const fixtures = parseJson(
    await fs.readFile(fixturesPath, "utf8").catch(() => "null"),
    "Local fixtures",
  );
  const finishedFixtureIds = (fixtures?.response || [])
    .filter((fixture) => new Set(["FT", "AET", "PEN"]).has(fixture?.fixture?.status?.short))
    .map((fixture) => String(fixture.fixture.id));
  let hydratedMatches = 0;
  await fs.mkdir(playerMatchDir, { recursive: true });
  for (const fixtureId of finishedFixtureIds) {
    const cachePath = path.join(playerMatchDir, `${fixtureId}.json`);
    const local = parseJson(
      await fs.readFile(cachePath, "utf8").catch(() => "null"),
      `Local player cache ${fixtureId}`,
    );
    if (isMatchCache(local, fixtureId)) continue;

    try {
      const response = await fetch(`${liveBaseUrl}/player-stats/matches/${fixtureId}.json`, {
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      if (response.status === 404) continue;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const liveCache = parseJson(await response.text(), `Deployed player cache ${fixtureId}`);
      if (!isMatchCache(liveCache, fixtureId)) throw new Error("unexpected data shape");
      await fs.writeFile(cachePath, `${JSON.stringify(liveCache, null, 2)}\n`, "utf8");
      hydratedMatches += 1;
    } catch (error) {
      console.warn(`Could not synchronize player cache ${fixtureId}: ${error.message}`);
    }
  }
  console.log(`Hydrated ${hydratedMatches} missing per-match player caches.`);
}

await main();
