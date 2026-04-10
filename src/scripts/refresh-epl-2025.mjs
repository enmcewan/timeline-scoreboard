// scripts/refresh-epl-2025.mjs
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseMatchweekNumber, getForcedRefreshRounds } from "../lib/utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log("REFRESH EPL SCRIPT STARTED");

/* ------------ PATHS ------------- */

const FIXTURES_RAW_PATH = path.join(
  __dirname,
  "..",
  "..",
  "public",
  "data",
  "leagues",
  "epl",
  "2025-26",
  "fixtures.raw.json"
);

const EVENTS_RAW_PATH = path.join(
  __dirname,
  "..",
  "..",
  "public",
  "data",
  "leagues",
  "epl",
  "2025-26",
  "events.raw.json"
);

const MATCHWEEKS_DIR = path.join(
  __dirname,
  "..",
  "..",
  "public",
  "data",
  "leagues",
  "epl",
  "2025-26",
  "matchweeks"
);

const BASE_URL = "https://v3.football.api-sports.io";
const API_KEY = process.env.APIFOOTBALL_KEY;

if (!API_KEY) {
  console.error("Missing APIFOOTBALL_KEY env var (APIFOOTBALL_KEY)");
  process.exit(1);
}

async function apiGet(pathname) {
  const url = `${BASE_URL}${pathname}`;
  const res = await fetch(url, { headers: { "x-apisports-key": API_KEY } });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`API ${res.status} for ${url}\n${txt}`);
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

const toNum = (v, fallback = 0) => {
  if (v == null) return fallback;
  if (typeof v === "number") return Number.isFinite(v) ? v : fallback;
  const s = String(v).trim();
  if (!s) return fallback;
  const n = Number(s.replace("%", ""));
  return Number.isFinite(n) ? n : fallback;
};

function statsToMap(arr) {
  const m = {};
  for (const s of arr || []) m[s.type] = s.value;
  return m;
}

function normalizeTeamStats(statArray) {
  const m = statsToMap(statArray);

  return {
    xg: Number(toNum(m["expected_goals"], 0).toFixed(2)),
    poss: m["Ball Possession"] ?? "0%",
    shots: toNum(m["Total Shots"], 0),
    sot: toNum(m["Shots on Goal"], 0),
    shotsInsideBox: toNum(m["Shots insidebox"], 0),
    blockedShots: toNum(m["Blocked Shots"], 0),
    saves: toNum(m["Goalkeeper Saves"], 0),
    corners: toNum(m["Corner Kicks"], 0),
    fouls: toNum(m["Fouls"], 0),
    yc: toNum(m["Yellow Cards"], 0),
    rc: toNum(m["Red Cards"], 0),
    goalsPrevented: toNum(m["goals_prevented"], 0),
  };
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

/* ------------ SMALL HELPERS ------------- */

function slugTeamName(name) {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// function parseMatchweekNumber(round) {
//   if (!round) return null;
//   const m = String(round).match(/(\d+)\s*$/);
//   return m ? Number(m[1]) : null;
// }

function getCurrentRound(fixtures) {
  const rounds = fixtures
    .map((fx) => parseMatchweekNumber(fx?.league?.round))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (!rounds.length) return null;

  const completedStates = new Set(["FT", "AET", "PEN"]);

  for (const round of [...new Set(rounds)]) {
    const roundFixtures = fixtures.filter(
      (fx) => parseMatchweekNumber(fx?.league?.round) === round
    );

    if (!roundFixtures.length) continue;

    const hasIncomplete = roundFixtures.some((fx) => {
      const s = String(fx?.fixture?.status?.short ?? "").toUpperCase();
      return !completedStates.has(s);
    });

    if (hasIncomplete) return round;
  }

  return rounds[rounds.length - 1];
}

function minuteLabel(time) {
  const base = time?.elapsed ?? 0;
  const extra = time?.extra;
  if (extra == null) return `${base}'`;
  return `${base}'+${extra}`;
}

function normaliseEventKind(type, detail) {
  const t = (type || "").toLowerCase();
  const d = (detail || "").toLowerCase();

  if (t === "goal") {
    if (d.includes("own")) return { kind: "own-goal", detail: "og" };
    if (d.includes("penalty")) {
      if (d.includes("missed")) return { kind: "penalty-miss", detail: "missed pen" };
      return { kind: "goal", detail: "pen" };
    }
    return { kind: "goal", detail: "" };
  }

  if (t === "card") {
    if (d.includes("red")) return { kind: "red", detail: "" };
    if (d.includes("yellow")) return { kind: "yellow", detail: "" };
  }

  if (t === "subst") return { kind: "sub", detail: "" };

  if (t === "var") {
    if (d.includes("goal cancelled")) return { kind: "var-goal-cancelled", detail: "" };
    if (d.includes("penalty cancelled")) return { kind: "var-pen-cancelled", detail: "" };
    if (d.includes("penalty confirmed")) return { kind: "var-pen-confirmed", detail: "" };
    if (d.includes("goal disallowed - offside")) return { kind: "var-goal-disallowed-offside", detail: "offside" };
    if (d.includes("goal disallowed")) return { kind: "var-goal-disallowed", detail: "other" };
    if (d.includes("card upgrade")) return { kind: "var-card-upgrade", detail: "" };
    if (d.includes("goal confirmed")) return { kind: "var-goal-confirmed", detail: "" };
  }

  return { kind: "other", detail: "" };
}

/* ------------ EVENT TRANSFORM ------------- */

function transformEventsForFixture(rawEvents, fixtureId, homeApiId, awayApiId) {
  return rawEvents.map((ev, index) => {
    const { kind, detail } = normaliseEventKind(ev.type, ev.detail);

    const teamSide =
      ev.team?.id === homeApiId
        ? "home"
        : ev.team?.id === awayApiId
          ? "away"
          : "home";

    const playerName = ev.player?.name ?? "";
    const assistName = ev.assist?.name ?? "";

    let inPlayer;
    let outPlayer;

    if (kind === "sub") {
      inPlayer = assistName;
      outPlayer = playerName;
    }

    const elapsed = ev.time?.elapsed ?? 0;
    const extra = ev.time?.extra ?? 0;

    return {
      id: `${fixtureId}-${index}`,
      minute: minuteLabel(ev.time),
      team: teamSide,
      kind,
      player: playerName,
      playerId: ev.player?.id ?? null,
      assist: assistName,
      assistId: ev.assist?.id ?? null,
      inPlayer,
      outPlayer,
      detail,
      rawType: ev.type,
      rawDetail: ev.detail,
      comments: ev.comments,
      elapsed,
      extra,
    };
  });
}

/* ------------ FIXTURE + EVENTS → INTERNAL MATCH ------------- */

function transformFixtureAndEvents(rawFixture, rawEventsForFixture) {
  const fx = rawFixture.fixture;
  const lg = rawFixture.league;
  const teams = rawFixture.teams;
  const goals = rawFixture.goals;
  const score = rawFixture.score;

  const homeApiId = teams.home.id;
  const awayApiId = teams.away.id;

  const matchId = String(fx.id);

  const statusState = (() => {
    const s = fx.status?.short;
    const elapsed = fx.status?.elapsed;
    if (s === "FT") return "FT";
    if (s === "HT") return "HT";
    if (typeof elapsed === "number") return `${elapsed}'`;
    return s || "";
  })();

  const htScore =
    score?.halftime?.home != null && score?.halftime?.away != null
      ? `${score.halftime.home}–${score.halftime.away}`
      : "";

  const events = transformEventsForFixture(
    rawEventsForFixture,
    matchId,
    homeApiId,
    awayApiId
  );

  const homeYcMinutes = [];
  const awayYcMinutes = [];
  const homeRcMinutes = [];
  const awayRcMinutes = [];
  let homeDisallowed = 0;
  let awayDisallowed = 0;
  let homeOwnGoalsFor = 0;
  let awayOwnGoalsFor = 0;

  for (const e of events) {
    const minute = Number(e.elapsed ?? 0);

    if (e.kind === "yellow") {
      if (e.team === "home") homeYcMinutes.push(minute);
      else if (e.team === "away") awayYcMinutes.push(minute);
    }

    if (e.kind === "red") {
      if (e.team === "home") homeRcMinutes.push(minute);
      else if (e.team === "away") awayRcMinutes.push(minute);
    }

    if (e.kind === "own-goal") {
      if (e.team === "home") homeOwnGoalsFor++;
      else if (e.team === "away") awayOwnGoalsFor++;
    }

    const DISALLOWED_KINDS = new Set([
      "var-goal-cancelled",
      "var-goal-disallowed-offside",
      "var-goal-disallowed",
    ]);

    if (DISALLOWED_KINDS.has(e.kind)) {
      if (e.team === "home") homeDisallowed++;
      else if (e.team === "away") awayDisallowed++;
    }
  }

  return {
    id: matchId,
    league: lg.name,
    venue: fx.venue?.name ?? "",
    attendance: null,
    kickoff: fx.date,
    homeTeamId: slugTeamName(teams.home.name),
    awayTeamId: slugTeamName(teams.away.name),
    score: {
      home: goals.home ?? 0,
      away: goals.away ?? 0,
    },
    status: {
      state: statusState,
      halfTimeScore: htScore,
    },
    events,
    statistics: {
      home: {
        ycMinutes: homeYcMinutes,
        rcMinutes: homeRcMinutes,
        disallowedGoals: homeDisallowed,
        ownGoalsFor: homeOwnGoalsFor,
      },
      away: {
        ycMinutes: awayYcMinutes,
        rcMinutes: awayRcMinutes,
        disallowedGoals: awayDisallowed,
        ownGoalsFor: awayOwnGoalsFor,
      }
    }
  };
}

/* ------------ GROUP EVENTS BY FIXTURE ------------- */

function groupEventsByFixture(eventsResponseArray) {
  const byFixture = new Map();

  for (const ev of eventsResponseArray) {
    const fixtureId =
      ev.fixture?.id ??
      ev.fixtureId ??
      ev.fixture_id ??
      ev._fixtureId ??
      null;

    if (!fixtureId) continue;

    const key = String(fixtureId);
    if (!byFixture.has(key)) byFixture.set(key, []);
    byFixture.get(key).push(ev);
  }

  return byFixture;
}

/* ------------ EXISTING MATCHWEEKS CACHE ------------- */

async function readExistingMatchweeks() {
  const byRound = new Map();
  const byFixtureId = new Map();

  try {
    const files = await fs.readdir(MATCHWEEKS_DIR);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;

      const fullPath = path.join(MATCHWEEKS_DIR, file);
      const txt = await fs.readFile(fullPath, "utf8");
      const json = JSON.parse(txt);

      const round = Number(json?.round);
      const matches = Array.isArray(json?.matches) ? json.matches : [];

      if (!Number.isFinite(round)) continue;

      byRound.set(round, matches);

      for (const match of matches) {
        byFixtureId.set(String(match.id), match);
      }
    }
  } catch {
    // no existing cache yet
  }

  return { byRound, byFixtureId };
}

function upsertMatch(roundMap, round, match) {
  const arr = roundMap.get(round) ?? [];
  const key = String(match.id);
  const idx = arr.findIndex((m) => String(m.id) === key);

  if (idx >= 0) arr[idx] = match;
  else arr.push(match);

  roundMap.set(round, arr);
}

/* ------------ MAIN ------------- */

async function main() {
  console.log("Reading raw fixtures…");
  const fixturesRaw = JSON.parse(await fs.readFile(FIXTURES_RAW_PATH, "utf8"));

  console.log("Reading raw events…");
  const eventsRaw = JSON.parse(await fs.readFile(EVENTS_RAW_PATH, "utf8"));

  const fixtures = fixturesRaw.response ?? [];
  const eventsArr = eventsRaw.response ?? [];

  console.log(`Fixtures: ${fixtures.length}`);
  console.log(`Events:   ${eventsArr.length}`);

  const eventsByFixture = groupEventsByFixture(eventsArr);

  const { byRound: existingMatchweeks, byFixtureId: existingMatchesByFixtureId } =
    await readExistingMatchweeks();

  // const currentRound = getCurrentRound(fixtures);
  // const previousRound = currentRound && currentRound > 1 ? currentRound - 1 : currentRound;
  // const forcedRounds = new Set([previousRound, currentRound].filter(Number.isFinite));

  // console.log(`Always refresh rounds: ${[...forcedRounds].sort((a, b) => a - b).join(", ")}`);

  const forcedRounds = getForcedRefreshRounds(fixtures);

  console.log(
    `Always refresh rounds: ${[...forcedRounds].sort((a, b) => a - b).join(", ")}`
  );

  const matchweeks = new Map(existingMatchweeks);
  const touchedRounds = new Set();

  for (const f of fixtures) {
    const fixtureId = String(f.fixture.id);
    const round = parseMatchweekNumber(f.league.round);

    if (!round) {
      console.warn("Could not parse matchweek for fixture", fixtureId, f.league.round);
      continue;
    }

    const existingMatch = existingMatchesByFixtureId.get(fixtureId);
    const shouldForceRefresh = forcedRounds.has(round);
    const shouldBuildMissing = !existingMatch;

    if (!shouldForceRefresh && !shouldBuildMissing) {
      continue;
    }

    const rawEventsForFixture = eventsByFixture.get(fixtureId) ?? [];
    const rebuiltMatch = transformFixtureAndEvents(f, rawEventsForFixture);

    try {
      const homeApiId = f.teams?.home?.id;
      const awayApiId = f.teams?.away?.id;

      if (homeApiId && awayApiId) {
        const stats = await fetchFixtureStatistics(fixtureId, homeApiId, awayApiId);

        if (stats) {
          const prevHome = rebuiltMatch.statistics?.home ?? {};
          const prevAway = rebuiltMatch.statistics?.away ?? {};

          rebuiltMatch.statistics = {
            home: { ...stats.home, ...prevHome },
            away: { ...stats.away, ...prevAway },
          };
        } else if (existingMatch?.statistics?.home?.xg != null && existingMatch?.statistics?.away?.xg != null) {
          console.warn(`No fresh stats for fixture ${fixtureId}; keeping existing match.`);
          upsertMatch(matchweeks, round, existingMatch);
          touchedRounds.add(round);
          continue;
        } else {
          console.warn(`No stats for fixture ${fixtureId}`);
        }
      } else {
        console.warn(`Missing home/away api ids for fixture ${fixtureId}`);
      }
    } catch (e) {
      if (existingMatch?.statistics?.home?.xg != null && existingMatch?.statistics?.away?.xg != null) {
        console.warn(`Stats fetch failed for fixture ${fixtureId}; keeping existing match. ${e.message}`);
        upsertMatch(matchweeks, round, existingMatch);
        touchedRounds.add(round);
        continue;
      }

      console.warn(`Stats fetch failed for fixture ${fixtureId}: ${e.message}`);
    }

    upsertMatch(matchweeks, round, rebuiltMatch);
    touchedRounds.add(round);
  }

  await fs.mkdir(MATCHWEEKS_DIR, { recursive: true });

  const roundsToWrite =
    touchedRounds.size > 0
      ? [...touchedRounds].sort((a, b) => a - b)
      : [...matchweeks.keys()].sort((a, b) => a - b);

  for (const round of roundsToWrite) {
    const matches = [...(matchweeks.get(round) ?? [])];
    matches.sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));

    const outObj = {
      season: 2025,
      round,
      matches,
    };

    const outPath = path.join(MATCHWEEKS_DIR, `${round}.json`);
    await fs.writeFile(outPath, JSON.stringify(outObj, null, 2), "utf8");
    console.log(`Wrote matchweek ${round} → ${outPath} (${matches.length} matches)`);
  }

  console.log("Done refreshing matchweeks.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});