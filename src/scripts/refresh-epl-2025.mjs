// scripts/refresh-epl-2025.mjs
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log("SCRIPT STARTED");


/* ------------ PATHS – ADJUST TO YOUR TREE ------------- */

const FIXTURES_RAW_PATH = path.join(
  __dirname,
  "..",
  "data",
  "dev",
  "fixtures.raw.json"
);

const EVENTS_RAW_PATH = path.join(
  __dirname,
  "..",
  "data",
  "dev",
  "events.raw.json"
);

const MATCHDAYS_DIR = path.join(
  __dirname,
  "..",
  "data",
  "leagues",
  "epl",
  "2025",
  "matchdays"
);

/* ------------ SMALL HELPERS ------------- */

function slugTeamName(name) {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function parseMatchdayNumber(round) {
  // e.g. "Regular Season - 18" -> 18
  if (!round) return null;
  const m = String(round).match(/(\d+)\s*$/);
  return m ? Number(m[1]) : null;
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
    if (d.includes("own")) {
      return { kind: "own-goal", detail: "og" };
    }
    if (d.includes("penalty")) {
      if (d.includes("missed")) {
        return { kind: "penalty-miss", detail: "missed pen" };
      }
      return { kind: "goal", detail: "pen" };
    }
    return { kind: "goal", detail: "" }; // normal goal
  }

  if (t === "card") {
    if (d.includes("red")) return { kind: "red", detail: "" };
    if (d.includes("yellow")) return { kind: "yellow", detail: "" };
  }

  if (t === "subst") {
    return { kind: "sub", detail: "" };
  }

  if (t === "var") {
    if (d.includes("goal cancelled")) return { kind: "var-goal-cancelled", detail: "" };
    if (d.includes("penalty cancelled")) return { kind: "var-pen-cancelled", detail: "" };
    if (d.includes("penalty confirmed")) return { kind: "var-pen-confirmed", detail: "" };
    if (d.includes("goal disallowed - offside")) return { kind: "var-goal-disallowed", detail: "offside" }; 
    if (d.includes("card upgrade")) return { kind: "var-card-upgrade", detail: "" };
    if (d.includes("goal confirmed")) return { kind: "var-goal-confirmed", detail: "" };
  }

  return { kind: "other", detail: "" };
}

/* ------------ EVENT TRANSFORM ------------- */

function transformEventsForFixture(rawEvents, fixtureId, homeApiId, awayApiId) {
  // rawEvents: array of API events *for this fixture only*
  return rawEvents.map((ev, index) => {
    const { kind, detail } = normaliseEventKind(ev.type, ev.detail);

    const teamSide =
      ev.team?.id === homeApiId
        ? "home"
        : ev.team?.id === awayApiId
        ? "away"
        : "home"; // fallback

    const playerName = ev.player?.name ?? "";
    const assistName = ev.assist?.name ?? "";

    let inPlayer;
    let outPlayer;

    if (kind === "sub") {
      // API-Football: player = OUT, assist = IN
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
      assist: assistName,
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

  return {
    id: matchId,
    league: lg.name,
    venue: fx.venue?.name ?? "",
    attendance: null, // API-Football doesn't give this
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
  };
}

/* ------------ GROUP EVENTS BY FIXTURE ------------- */

function groupEventsByFixture(eventsResponseArray) {
  // responseArray is events.raw.json.response
  const byFixture = new Map();

  for (const ev of eventsResponseArray) {
    // depending on your fetch script, this may be ev.fixture.id or ev.fixtureId
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

  // matchdayNumber -> array of internal matches
  const matchdays = new Map();

  for (const f of fixtures) {
    const fixtureId = String(f.fixture.id);
    const md = parseMatchdayNumber(f.league.round);
    if (!md) {
      console.warn("Could not parse matchday for fixture", fixtureId, f.league.round);
      continue;
    }

    const rawEventsForFixture = eventsByFixture.get(fixtureId) ?? [];

    const internalMatch = transformFixtureAndEvents(
      f,
      rawEventsForFixture
    );

    if (!matchdays.has(md)) matchdays.set(md, []);
    matchdays.get(md).push(internalMatch);
  }

  // ensure output directory
  await fs.mkdir(MATCHDAYS_DIR, { recursive: true });

  // write one file per matchday
  const sortedDays = [...matchdays.keys()].sort((a, b) => a - b);

  for (const md of sortedDays) {
    const matches = matchdays.get(md);

    // sort by kickoff time just to keep things consistent
    matches.sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));

    const outObj = {
      season: 2025,      // or derive from fixturesRaw.league.season if you prefer
      round: md,         // numeric round: 1, 2, 3, ...
      matches,           // the array we already built
    };

    const outPath = path.join(MATCHDAYS_DIR, `${md}.json`);
    await fs.writeFile(outPath, JSON.stringify(outObj, null, 2), "utf8");
    console.log(
      `Wrote matchday ${md} → ${outPath} (${matches.length} matches)`
    );
  }

  console.log("Done rebuilding matchdays.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
