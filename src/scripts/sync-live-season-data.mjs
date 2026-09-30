import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getSeasonConfigFromEnv } from "../config/seasons.js";
import { applyTheStatsApiMatchData } from "./the-stats-api-xg.mjs";

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
const liveBaseUrl =
  process.env.LIVE_SEASON_DATA_URL ||
  `https://timelinefootball.com/data/leagues/${season.leagueKey}/${season.seasonPath}`;
const theStatsApiCachePath = path.join(seasonDataDir, "thestatsapi-xg.json");

function parseJson(text, label) {
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error(`${label} did not return valid JSON`);
  }
}

function validateCoreFile(fileName, data) {
  if (fileName === "fixtures.raw.json" || fileName === "events.raw.json") {
    return Array.isArray(data?.response);
  }
  if (fileName === "standings.json") {
    return data && typeof data === "object";
  }
  return false;
}

async function download(relativePath, validate) {
  const url = `${liveBaseUrl}/${relativePath.replaceAll("\\", "/")}`;
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`${relativePath} returned HTTP ${response.status}`);

  const text = await response.text();
  const data = parseJson(text, relativePath);
  if (!validate(data)) throw new Error(`${relativePath} has an unexpected data shape`);

  const targetPath = path.join(seasonDataDir, ...relativePath.split("/"));
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, text.replace(/^\uFEFF/, ""), "utf8");
  console.log(`Hydrated ${relativePath}`);
}

async function applyCachedTheStatsApiData() {
  let cache;
  try {
    cache = parseJson(await fs.readFile(theStatsApiCachePath, "utf8"), "TheStatsAPI cache");
  } catch (error) {
    if (error?.code === "ENOENT") {
      console.log("No local TheStatsAPI cache found; skipping cached stat overlay.");
      return;
    }
    throw error;
  }

  let updatedMatches = 0;
  for (let round = 1; round <= season.maxRound; round += 1) {
    const matchweekPath = path.join(seasonDataDir, "matchweeks", `${round}.json`);
    const matchweek = parseJson(await fs.readFile(matchweekPath, "utf8"), `matchweek ${round}`);
    let touched = false;

    for (const match of matchweek.matches || []) {
      const cached = cache?.fixtures?.[String(match.id)];
      if (!cached) continue;
      if (!applyTheStatsApiMatchData(match, cached)) continue;
      touched = true;
      updatedMatches += 1;
    }

    if (touched) {
      await fs.writeFile(matchweekPath, `${JSON.stringify(matchweek, null, 2)}\n`, "utf8");
    }
  }

  console.log(`Applied cached TheStatsAPI data to ${updatedMatches} matches.`);
}

async function main() {
  for (const fileName of ["fixtures.raw.json", "events.raw.json", "standings.json"]) {
    await download(fileName, (data) => validateCoreFile(fileName, data));
  }

  for (let round = 1; round <= season.maxRound; round += 1) {
    await download(
      `matchweeks/${round}.json`,
      (data) => Number(data?.round) === round && Array.isArray(data?.matches),
    );
  }

  await applyCachedTheStatsApiData();

  console.log(`Live ${season.leagueShortName} ${season.seasonLabel} season data synchronized.`);
}

await main();
