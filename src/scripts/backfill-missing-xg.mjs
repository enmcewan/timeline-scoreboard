import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getSeasonConfigFromEnv } from "../config/seasons.js";

const API_KEY = process.env.APIFOOTBALL_KEY;
const BASE_URL = "https://v3.football.api-sports.io";
const season = getSeasonConfigFromEnv();

if (!API_KEY) {
  console.error("Missing APIFOOTBALL_KEY env var (APIFOOTBALL_KEY)");
  process.exit(1);
}

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

function toNum(v, fallback = 0) {
  if (v == null) return fallback;
  if (typeof v === "number") return Number.isFinite(v) ? v : fallback;
  const s = String(v).trim();
  if (!s) return fallback;
  const n = Number(s.replace("%", ""));
  return Number.isFinite(n) ? n : fallback;
}

function toNullableNum(v) {
  const n = toNum(v, null);
  return Number.isFinite(n) ? n : null;
}

function statsToMap(arr) {
  const m = {};
  for (const s of arr || []) m[s.type] = s.value;
  return m;
}

function normalizeTeamStats(statArray) {
  const m = statsToMap(statArray);
  const xg = toNullableNum(m.expected_goals);

  return {
    xg: xg == null ? null : Number(xg.toFixed(2)),
    poss: m["Ball Possession"] ?? "0%",
    shots: toNum(m["Total Shots"], 0),
    sot: toNum(m["Shots on Goal"], 0),
    shotsInsideBox: toNum(m["Shots insidebox"], 0),
    blockedShots: toNum(m["Blocked Shots"], 0),
    saves: toNum(m["Goalkeeper Saves"], 0),
    corners: toNum(m["Corner Kicks"], 0),
    fouls: toNum(m.Fouls, 0),
    yc: toNum(m["Yellow Cards"], 0),
    rc: toNum(m["Red Cards"], 0),
    goalsPrevented: toNum(m.goals_prevented, 0),
  };
}

function hasXg(stats) {
  const hasValue = (value) =>
    value != null && String(value).trim() !== "" && Number.isFinite(Number(value));

  return hasValue(stats?.home?.xg) && hasValue(stats?.away?.xg);
}

async function readJson(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  return JSON.parse(text.replace(/^\uFEFF/, ""));
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
  console.log(`Wrote: ${filePath}`);
}

async function apiGet(pathname) {
  const url = `${BASE_URL}${pathname}`;
  console.log(`Fetching: ${url}`);

  const res = await fetch(url, { headers: { "x-apisports-key": API_KEY } });
  console.log("HTTP status:", res.status);

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status} for ${url}\n${text}`);
  }

  const json = await res.json();
  if (json?.errors && Object.keys(json.errors).length) {
    const msg = Object.entries(json.errors)
      .map(([k, v]) => `${k}: ${v}`)
      .join(" | ");
    throw new Error(`API returned error payload for ${url}: ${msg}`);
  }

  return json;
}

async function fetchFixtureStatistics(fixtureId, homeApiId, awayApiId) {
  const data = await apiGet(`/fixtures/statistics?fixture=${encodeURIComponent(fixtureId)}`);
  const resp = data?.response || [];
  if (resp.length < 2) return null;

  const byTeamId = new Map();
  for (const r of resp) {
    const tid = r?.team?.id;
    byTeamId.set(tid, normalizeTeamStats(r?.statistics));
  }

  const home = byTeamId.get(homeApiId) ?? null;
  const away = byTeamId.get(awayApiId) ?? null;
  if (!home || !away) return null;

  return { home, away };
}

function isStartedOrComplete(match) {
  const state = String(match?.status?.state || "").toUpperCase();
  if (state && !["NS", "TBD", "PST"].includes(state)) return true;

  const kickoff = Date.parse(match?.kickoff || "");
  if (!Number.isFinite(kickoff)) return false;

  // A stale cached status must not prevent delayed xG from being recovered.
  return kickoff <= Date.now() - 2 * 60 * 60 * 1000;
}

async function main() {
  const fixturesJson = await readJson(FIXTURES_RAW_PATH);
  const fixturesById = new Map(
    (fixturesJson?.response || []).map((fixture) => [String(fixture?.fixture?.id), fixture])
  );

  const files = (await fs.readdir(MATCHWEEKS_DIR))
    .filter((file) => /^\d+\.json$/.test(file))
    .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));

  let candidates = 0;
  let updated = 0;
  let stillMissing = 0;
  const touchedFiles = new Set();

  for (const file of files) {
    const filePath = path.join(MATCHWEEKS_DIR, file);
    const matchweek = await readJson(filePath);
    let touched = false;

    for (const match of matchweek.matches || []) {
      if (!isStartedOrComplete(match)) continue;
      if (hasXg(match.statistics)) continue;

      const fixtureId = String(match.id);
      const rawFixture = fixturesById.get(fixtureId);
      const homeApiId = rawFixture?.teams?.home?.id;
      const awayApiId = rawFixture?.teams?.away?.id;

      if (!homeApiId || !awayApiId) {
        console.warn(`Skipping ${fixtureId}: missing home/away API IDs.`);
        continue;
      }

      candidates++;

      try {
        const stats = await fetchFixtureStatistics(fixtureId, homeApiId, awayApiId);
        if (!hasXg(stats)) {
          console.log(`xG still unavailable for ${fixtureId}.`);
          stillMissing++;
          continue;
        }

        const eventHome = match.statistics?.home ?? {};
        const eventAway = match.statistics?.away ?? {};
        match.statistics = {
          home: { ...eventHome, ...stats.home },
          away: { ...eventAway, ...stats.away },
        };

        updated++;
        touched = true;
        console.log(`Backfilled xG for ${fixtureId}: ${stats.home.xg} / ${stats.away.xg}`);
      } catch (err) {
        console.warn(`Failed to backfill xG for ${fixtureId}: ${err?.message ?? err}`);
      }
    }

    if (touched) {
      await writeJson(filePath, matchweek);
      touchedFiles.add(file);
    }
  }

  console.log(
    `Done. Missing-xG candidates: ${candidates}. Updated: ${updated}. Still missing: ${stillMissing}. Files touched: ${[...touchedFiles].join(", ") || "none"}.`
  );
}

main().catch((err) => {
  console.error("Script error:", err);
  process.exit(1);
});
