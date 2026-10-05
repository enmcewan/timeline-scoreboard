import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getSeasonConfigFromEnv } from "../config/seasons.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");
const season = getSeasonConfigFromEnv();
const outputPath = path.join(
  projectRoot,
  "public",
  "data",
  "leagues",
  season.leagueKey,
  season.seasonPath,
  "player-stats.json",
);
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
    value.source === "thestatsapi" &&
    value.seasonPath === season.seasonPath &&
    Array.isArray(value.players)
  );
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
    return;
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(liveStats, null, 2)}\n`, "utf8");
  console.log(
    `Hydrated player stats: ${liveStats.players.length} players from ${liveStats.matchesIncluded || 0} matches.`,
  );
}

await main();
