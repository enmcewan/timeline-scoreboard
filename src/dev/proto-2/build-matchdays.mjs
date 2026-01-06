import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import fixturesRaw from "../../fixtures.raw.json" with { type: "json" };
import eventsRaw from "../../events.raw.json" with { type: "json" };
import teams from "../../teams.json" with { type: "json" };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- config ----
const SEASON = 2025;
const LEAGUE_SLUG = "epl";
const OUT_DIR = path.join(
  __dirname,
  `../../data/leagues/${LEAGUE_SLUG}/${SEASON}/matchdays`
);

// --------------------------------------------------
// Helpers
// --------------------------------------------------

function buildTeamNameIndex(teamsObj) {
  const index = new Map();
  for (const [id, info] of Object.entries(teamsObj)) {
    index.set(info.name.toLowerCase(), id);
  }
  return index;
}

const TEAM_NAME_INDEX = buildTeamNameIndex(teams);

function minuteToString(timeObj) {
  const min = timeObj?.elapsed ?? 0;
  return `${min}'`;
}

function mapTypeDetailToKindDetail(type, detail) {
  const t = (type || "").toLowerCase();
  const d = (detail || "").toLowerCase();

  // Goals
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
    return { kind: "goal", detail: "" };
  }

  // Cards
  if (t === "card") {
    if (d.includes("red")) return { kind: "red", detail: "" };
    if (d.includes("yellow")) return { kind: "yellow", detail: "" };
  }

  // VAR
  if (t === "var") {
    if (d.includes("goal cancelled")) {
      return { kind: "var-goal-cancelled", detail: "" };
    }
    return { kind: "var", detail: d };
  }

  // Subs
  if (t === "subst") {
    return { kind: "sub", detail: "" };
  }

  return { kind: "other", detail: d };
}

function normalizeEvent(apiEvt, fx) {
  const minute = minuteToString(apiEvt.time);

  const homeId = fx.teams.home.id;
  const awayId = fx.teams.away.id;
  const evtTeamId = apiEvt.team?.id;

  const side = evtTeamId === awayId ? "away" : "home";

  const { kind, detail } = mapTypeDetailToKindDetail(apiEvt.type, apiEvt.detail);

  const playerName = apiEvt.player?.name ?? "";
  const assistName = apiEvt.assist?.name ?? "";

  let inPlayer;
  let outPlayer;

  if (kind === "sub") {
    // API: player = OUT, assist = IN
    inPlayer = assistName;
    outPlayer = playerName;
  }

  return {
    id: `${fx.fixture.id}-${apiEvt.time?.elapsed ?? 0}-${kind}-${Math.random()
      .toString(36)
      .slice(2, 7)}`,
    minute,
    team: side,
    kind,
    player: playerName,
    assist: assistName || "",
    inPlayer,
    outPlayer,
    detail,
    rawType: apiEvt.type,
    rawDetail: apiEvt.detail
  };
}

// 🔑 THIS is the missing piece: group by fixtureId
function groupEventsByFixture(eventsArr) {
  const map = new Map();
  for (const e of eventsArr) {
    const fid = e.fixtureId;
    if (!fid) continue;
    if (!map.has(fid)) map.set(fid, []);
    map.get(fid).push(e);
  }
  return map;
}

function parseRoundNumber(roundStr) {
  // e.g. "Regular Season - 18" → 18
  const m = /(\d+)/.exec(roundStr || "");
  return m ? Number(m[1]) : null;
}

// --------------------------------------------------
// Main
// --------------------------------------------------

async function main() {
  const fixtures = fixturesRaw.response || [];
  const events = eventsRaw.response || [];

  if (!fixtures.length) {
    console.error("No fixtures in fixtures.raw.json");
    return;
  }

  console.log(`Fixtures: ${fixtures.length}, Events: ${events.length}`);

  const eventsByFixture = groupEventsByFixture(events);

  const matchesByRound = new Map();

  for (const fx of fixtures) {
    const fixture = fx.fixture;
    const lg = fx.league;

    if (lg.season !== SEASON) continue; // just in case

    const roundNum = parseRoundNumber(lg.round);
    if (!roundNum) {
      console.warn("Could not parse round number for fixture", fixture.id, lg.round);
      continue;
    }

    const homeNameLc = fx.teams.home.name.toLowerCase();
    const awayNameLc = fx.teams.away.name.toLowerCase();

    const homeTeamId =
      TEAM_NAME_INDEX.get(homeNameLc) ??
      (() => {
        throw new Error(`No team id mapping for home team "${fx.teams.home.name}"`);
      })();

    const awayTeamId =
      TEAM_NAME_INDEX.get(awayNameLc) ??
      (() => {
        throw new Error(`No team id mapping for away team "${fx.teams.away.name}"`);
      })();

    const rawEvents = eventsByFixture.get(fixture.id) || [];
    const normalizedEvents = rawEvents
      .map((e) => normalizeEvent(e, fx))
      .sort((a, b) => {
        const ma = parseInt(a.minute, 10) || 0;
        const mb = parseInt(b.minute, 10) || 0;
        return ma - mb;
      });

    const halftime = fx.score?.halftime;
    const halfTimeScore =
      halftime && typeof halftime.home === "number" && typeof halftime.away === "number"
        ? `${halftime.home}–${halftime.away}`
        : "";

    const match = {
      id: `${fixture.date.slice(0, 10)}-${homeTeamId}-${awayTeamId}`,
      league: lg.name,
      venue: fixture.venue?.name ?? "",
      attendance: null,
      kickoff: fixture.date,
      homeTeamId,
      awayTeamId,
      score: {
        home: fx.goals.home ?? 0,
        away: fx.goals.away ?? 0
      },
      status: {
        state: fixture.status?.short ?? "",
        halfTimeScore
      },
      events: normalizedEvents
    };

    if (!matchesByRound.has(roundNum)) {
      matchesByRound.set(roundNum, []);
    }
    matchesByRound.get(roundNum).push(match);
  }

  await fs.mkdir(OUT_DIR, { recursive: true });

  for (const [roundNum, matches] of matchesByRound.entries()) {
    const outFile = path.join(OUT_DIR, `${roundNum}.json`);
    const payload = {
      season: SEASON,
      round: roundNum,
      matches
    };
    await fs.writeFile(outFile, JSON.stringify(payload, null, 2), "utf8");
    console.log(`Wrote round ${roundNum} (${matches.length} matches) → ${outFile}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
