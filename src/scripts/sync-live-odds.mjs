import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getSeasonConfigFromEnv } from "../config/seasons.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");
const season = getSeasonConfigFromEnv();
const oddsPath = path.join(
  projectRoot,
  "public",
  "data",
  "leagues",
  season.leagueKey,
  season.seasonPath,
  "odds.json",
);
const liveOddsUrl =
  process.env.LIVE_ODDS_URL ||
  `https://timelinefootball.com/data/leagues/${season.leagueKey}/${season.seasonPath}/odds.json`;

function stripBom(value) {
  return value.replace(/^\uFEFF/, "");
}

async function readLocalOdds() {
  try {
    return JSON.parse(stripBom(await fs.readFile(oddsPath, "utf8")));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function readLiveOdds() {
  const response = await fetch(liveOddsUrl, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Live odds request returned HTTP ${response.status}`);
  }

  const body = await response.text();
  const parsed = JSON.parse(stripBom(body));
  if (!parsed || typeof parsed.fixtures !== "object" || Array.isArray(parsed.fixtures)) {
    throw new Error("Live odds response does not contain a fixtures map");
  }
  return parsed;
}

function timestamp(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function entryTimestamp(entry) {
  return Math.max(timestamp(entry?.capturedAt), timestamp(entry?.apiUpdatedAt));
}

function mergeEntry(localEntry, liveEntry) {
  if (!localEntry) return liveEntry;
  if (!liveEntry) return localEntry;

  const newer = entryTimestamp(liveEntry) >= entryTimestamp(localEntry) ? liveEntry : localEntry;
  const older = newer === liveEntry ? localEntry : liveEntry;
  const lockedEntry = localEntry.locked ? localEntry : liveEntry.locked ? liveEntry : null;

  return {
    ...older,
    ...newer,
    ...(lockedEntry
      ? {
          locked: true,
          lockedAt: lockedEntry.lockedAt || newer.lockedAt || older.lockedAt,
          statusAtLock: lockedEntry.statusAtLock || newer.statusAtLock || older.statusAtLock,
        }
      : {}),
  };
}

function latestUpdated(...documents) {
  return documents
    .map((document) => document?.updated)
    .filter(Boolean)
    .sort((a, b) => timestamp(b) - timestamp(a))[0];
}

function mergeOdds(localOdds, liveOdds) {
  const localFixtures = localOdds?.fixtures || {};
  const liveFixtures = liveOdds?.fixtures || {};
  const fixtureIds = [...new Set([...Object.keys(localFixtures), ...Object.keys(liveFixtures)])].sort(
    (a, b) => Number(a) - Number(b),
  );
  const fixtures = Object.fromEntries(
    fixtureIds.map((fixtureId) => [
      fixtureId,
      mergeEntry(localFixtures[fixtureId], liveFixtures[fixtureId]),
    ]),
  );

  return {
    ...(liveOdds || {}),
    ...(localOdds || {}),
    league: liveOdds?.league || localOdds?.league || season.apiLeagueId,
    season: liveOdds?.season || localOdds?.season || season.apiSeason,
    updated: latestUpdated(localOdds, liveOdds) || new Date().toISOString(),
    fixtures,
  };
}

async function main() {
  const localOdds = await readLocalOdds();
  let liveOdds;
  try {
    liveOdds = await readLiveOdds();
  } catch (error) {
    console.warn(`Could not synchronize deployed odds: ${error.message}`);
    console.warn("Keeping the local odds archive unchanged.");
    return;
  }

  const merged = mergeOdds(localOdds, liveOdds);
  const localCount = Object.keys(localOdds?.fixtures || {}).length;
  const liveCount = Object.keys(liveOdds.fixtures).length;
  const mergedCount = Object.keys(merged.fixtures).length;
  const output = `${JSON.stringify(merged, null, 2)}\n`;
  const current = localOdds ? `${JSON.stringify(localOdds, null, 2)}\n` : "";

  if (output !== current) {
    await fs.mkdir(path.dirname(oddsPath), { recursive: true });
    await fs.writeFile(oddsPath, output, "utf8");
    console.log(`Merged deployed odds into ${oddsPath}`);
  } else {
    console.log("Local odds archive already contains every deployed entry.");
  }
  console.log(`Odds entries: local ${localCount}, deployed ${liveCount}, merged ${mergedCount}.`);
}

await main();
