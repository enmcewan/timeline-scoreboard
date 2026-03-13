import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// repo root (src/scripts -> src -> root)
const ROOT = path.join(__dirname, "../..");

const MATCHDAYS_DIR = path.join(
  ROOT,
  "public",
  "data",
  "leagues",
  "epl",
  "2025",
  "matchdays"
);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function getNumericMatchdayFiles(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d+\.json$/.test(f))
    .sort((a, b) => Number(a.replace(".json", "")) - Number(b.replace(".json", "")));
}

function isFinishedMatch(match) {
  const state = match?.status?.state ?? "";
  return ["FT", "AET", "PEN"].includes(state);
}

function isRoundComplete(matches) {
  return matches.length > 0 && matches.every(isFinishedMatch);
}

function getResultChar(goalsFor, goalsAgainst) {
  if (goalsFor > goalsAgainst) return "W";
  if (goalsFor < goalsAgainst) return "L";
  return "D";
}

function createTeamRow() {
  return {
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    gf: 0,
    ga: 0,
    gd: 0,
    points: 0,
    form: []
  };
}

function ensureTeam(table, slug) {
  if (!table[slug]) table[slug] = createTeamRow();
  return table[slug];
}

function sortTableEntries(table) {
  return Object.entries(table).sort((a, b) => {
    const rowA = a[1];
    const rowB = b[1];

    if (rowB.points !== rowA.points) return rowB.points - rowA.points;
    if (rowB.gd !== rowA.gd) return rowB.gd - rowA.gd;
    if (rowB.gf !== rowA.gf) return rowB.gf - rowA.gf;

    return a[0].localeCompare(b[0]);
  });
}

function buildPositionsMap(table) {
  const sorted = sortTableEntries(table);
  const out = {};

  sorted.forEach(([slug], idx) => {
    out[slug] = idx + 1;
  });

  return out;
}

function formString(formArr, count = 5) {
  return formArr.slice(-count).join("");
}

function applyMatchResult(table, match) {
  const homeSlug = match.homeTeamId;
  const awaySlug = match.awayTeamId;
  const homeGoals = Number(match?.score?.home ?? 0);
  const awayGoals = Number(match?.score?.away ?? 0);

  const home = ensureTeam(table, homeSlug);
  const away = ensureTeam(table, awaySlug);

  home.played += 1;
  away.played += 1;

  home.gf += homeGoals;
  home.ga += awayGoals;
  away.gf += awayGoals;
  away.ga += homeGoals;

  home.gd = home.gf - home.ga;
  away.gd = away.gf - away.ga;

  if (homeGoals > awayGoals) {
    home.wins += 1;
    away.losses += 1;
    home.points += 3;
  } else if (homeGoals < awayGoals) {
    away.wins += 1;
    home.losses += 1;
    away.points += 3;
  } else {
    home.draws += 1;
    away.draws += 1;
    home.points += 1;
    away.points += 1;
  }

  home.form.push(getResultChar(homeGoals, awayGoals));
  away.form.push(getResultChar(awayGoals, homeGoals));
}

function collectAllTeams(matchdayFiles) {
  const teams = new Set();

  for (const { data } of matchdayFiles) {
    for (const match of data.matches || []) {
      if (match.homeTeamId) teams.add(match.homeTeamId);
      if (match.awayTeamId) teams.add(match.awayTeamId);
    }
  }

  return [...teams].sort();
}

function assignPreMatchContext(table, match) {
  const homeSlug = match.homeTeamId;
  const awaySlug = match.awayTeamId;

  const positions = buildPositionsMap(table);
  const homeRow = ensureTeam(table, homeSlug);
  const awayRow = ensureTeam(table, awaySlug);

  const homePosition = homeRow.played === 0 ? null : (positions[homeSlug] ?? null);
  const awayPosition = awayRow.played === 0 ? null : (positions[awaySlug] ?? null);

  match.context = match.context || {};
  match.context.preMatch = {
    homeForm: formString(homeRow.form),
    awayForm: formString(awayRow.form),
    homePosition,
    awayPosition,
    homePoints: homeRow.points,
    awayPoints: awayRow.points,
    homePlayed: homeRow.played,
    awayPlayed: awayRow.played,
    homeGD: homeRow.gd,
    awayGD: awayRow.gd,
    homeGF: homeRow.gf,
    awayGF: awayRow.gf
  };
}

function clearPreMatchContext(match) {
  if (match?.context?.preMatch) {
    delete match.context.preMatch;
    if (Object.keys(match.context).length === 0) {
      delete match.context;
    }
  }
}

function main() {
  const files = getNumericMatchdayFiles(MATCHDAYS_DIR);

  if (!files.length) {
    throw new Error(`No numeric matchday files found in ${MATCHDAYS_DIR}`);
  }

  const matchdayFiles = files.map((filename) => {
    const filePath = path.join(MATCHDAYS_DIR, filename);
    return {
      filename,
      round: Number(filename.replace(".json", "")),
      filePath,
      data: readJson(filePath)
    };
  });

  const allTeams = collectAllTeams(matchdayFiles);
  const table = {};
  for (const slug of allTeams) table[slug] = createTeamRow();

  let nextRoundToPopulate = null;
  let encounteredIncompleteRound = false;

  for (let i = 0; i < matchdayFiles.length; i += 1) {
    const md = matchdayFiles[i];
    const allMatches = md.data.matches || [];
    const finishedMatches = allMatches.filter(isFinishedMatch);
    const roundComplete = isRoundComplete(allMatches);

    const shouldAssignContext =
      roundComplete || (!encounteredIncompleteRound && nextRoundToPopulate === md.round);

    if (shouldAssignContext) {
      for (const match of allMatches) {
        assignPreMatchContext(table, match);
      }
    } else {
      for (const match of allMatches) {
        clearPreMatchContext(match);
      }
    }

    for (const match of finishedMatches) {
      applyMatchResult(table, match);
    }

    if (!encounteredIncompleteRound) {
      if (roundComplete) {
        nextRoundToPopulate = md.round + 1;
      } else {
        encounteredIncompleteRound = true;
      }
    }
  }

  for (const md of matchdayFiles) {
    writeJson(md.filePath, md.data);
  }

  console.log(`Updated round-based pre-match context in ${matchdayFiles.length} matchday files.`);
}

main();