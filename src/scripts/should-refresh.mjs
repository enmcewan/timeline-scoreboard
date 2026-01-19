import fs from "node:fs/promises";
import path from "node:path";

// ---- FORCE OVERRIDE (GitHub Actions workflow_dispatch input) ----
if (process.env.FORCE_REFRESH === "true" || process.env.FORCE_REFRESH === "1") {
  console.log("REFRESH=1");
  console.log("Reason: FORCE_REFRESH set");
  process.exit(0);
}


const CANDIDATE_FIXTURE_PATHS = [
  // adjust/add if your repo stores fixtures elsewhere
  "src/data/dev/fixtures.raw.json",
  "src/data/leagues/epl/2025/fixtures.raw.json",
  "src/data/leagues/epl/fixtures.raw.json",
];

const LIVE_STATUS = new Set([
  "1H", "HT", "2H", "ET", "BT", "P", // in-play variants
]);

const FINISHED_STATUS = new Set([
  "FT", "AET", "PEN", // finished variants
]);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--fixtures" && argv[i + 1]) out.fixtures = argv[++i];
  }
  return out;
}

async function firstExistingPath(paths) {
  for (const p of paths) {
    try {
      await fs.access(p);
      return p;
    } catch {}
  }
  return null;
}

function getKickoffMs(fx) {
  // API-Football provides both ISO date and timestamp
  if (fx?.fixture?.timestamp) return Number(fx.fixture.timestamp) * 1000;
  const iso = fx?.fixture?.date;
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : NaN;
}

function getStatusShort(fx) {
  return String(fx?.fixture?.status?.short ?? "").toUpperCase();
}

function isLiveish(statusShort) {
  // treat anything not-finished and not-not-started as "live-ish"
  if (LIVE_STATUS.has(statusShort)) return true;

  // Common other non-live but not-started/finished states:
  // NS (not started), PST (postponed), CANC, ABD, SUSP, INT, WO, TBD
  // We only consider "live-ish" for the explicit LIVE set above.
  return false;
}

function isFinished(statusShort) {
  return FINISHED_STATUS.has(statusShort);
}

function shouldRefresh(fixtures, nowMs) {
  const now = new Date(nowMs);
  const utcMin = now.getUTCMinutes();
  const utcHour = now.getUTCHours();

  const kickoffTimes = [];
  let anyLive = false;
  let anyRecentUnfinished = false;

  for (const fx of fixtures) {
    const ko = getKickoffMs(fx);
    if (Number.isFinite(ko)) kickoffTimes.push(ko);

    const st = getStatusShort(fx);
    if (isLiveish(st)) anyLive = true;

    // unfinished within last 12h => we’re still in a match window (late games / long stoppage / etc.)
    if (!isFinished(st) && Number.isFinite(ko) && ko <= nowMs && nowMs - ko <= 12 * 60 * 60 * 1000) {
      anyRecentUnfinished = true;
    }
  }

  kickoffTimes.sort((a, b) => a - b);

  const nextKickoff = kickoffTimes.find((t) => t > nowMs);
  const lastKickoff = (() => {
    for (let i = kickoffTimes.length - 1; i >= 0; i--) {
      if (kickoffTimes[i] <= nowMs) return kickoffTimes[i];
    }
    return null;
  })();

  const minsToNext = nextKickoff ? (nextKickoff - nowMs) / 60000 : Infinity;
  const minsSinceLast = lastKickoff ? (nowMs - lastKickoff) / 60000 : Infinity;

  // Windows
  const withinPre = minsToNext <= 120;      // 2h before kickoff
  const withinPost = minsSinceLast <= 180;  // 3h after last kickoff
  const within36h = minsToNext <= 36 * 60;

  // Decision rules (ordered)
  if (anyLive || anyRecentUnfinished) return true;
  if (withinPre || withinPost) return true;

  // If there’s a matchday coming up soon, do a light refresh on the half-hour marks
  // (assumes workflow runs every ~10 min; this avoids hammering)
  if (within36h) return utcMin === 0 || utcMin === 30;

  // Otherwise: once a day at 06:00 UTC (pick any quiet hour you like)
  return utcHour === 6 && utcMin === 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const fixturesPath =
    args.fixtures ??
    process.env.FIXTURES_PATH ??
    (await firstExistingPath(CANDIDATE_FIXTURE_PATHS));

  if (!fixturesPath) {
    console.error("Gate: could not find fixtures.raw.json. Provide --fixtures <path> or set FIXTURES_PATH.");
    process.exit(2);
  }

  const raw = JSON.parse(await fs.readFile(fixturesPath, "utf8"));
  const fixtures = raw?.response ?? [];

  const ok = shouldRefresh(fixtures, Date.now());

  // Write a simple token that GitHub Actions can consume.
  // Also keep it human-readable for local runs.
  console.log(ok ? "REFRESH=1" : "REFRESH=0");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
