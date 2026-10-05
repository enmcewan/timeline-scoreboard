import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getSeasonConfigFromEnv } from "../config/seasons.js";

const BASE_URL = "https://api.thestatsapi.com/api";
const __filename = fileURLToPath(import.meta.url);
const ROOT = path.join(path.dirname(__filename), "../..");
const season = getSeasonConfigFromEnv();
const apiKey = process.env.TSAPI_KEY;
const refreshLatest = process.argv.includes("--refresh-latest");
const fixtureArg = process.argv.find((arg) => arg.startsWith("--fixture="));
const onlyFixtureId = fixtureArg ? fixtureArg.split("=")[1] : null;

const seasonDataDir = path.join(
  ROOT,
  "public",
  "data",
  "leagues",
  season.leagueKey,
  season.seasonPath
);
const fixturesPath = path.join(seasonDataDir, "fixtures.raw.json");
const eventsPath = path.join(seasonDataDir, "events.raw.json");
const matchCachePath = path.join(seasonDataDir, "thestatsapi-xg.json");
const playerMatchDir = path.join(seasonDataDir, "player-stats", "matches");
const aggregatePath = path.join(seasonDataDir, "player-stats.json");

const GROUP_FIELDS = {
  passing: [
    "total_passes",
    "accurate_passes",
    "key_passes",
    "assists",
    "total_crosses",
    "accurate_crosses",
    "total_long_balls",
    "accurate_long_balls",
  ],
  shooting: [
    "goals",
    "total_shots",
    "shots_on_target",
    "shots_off_target",
    "blocked_shots",
    "big_chances_created",
    "expected_goals",
    "expected_assists",
    "np_expected_goals",
  ],
  duels: [
    "duel_won",
    "duel_lost",
    "aerial_won",
    "challenge_lost",
    "won_contest",
    "dispossessed",
  ],
  defending: ["tackles", "interceptions", "clearances", "ball_recoveries"],
  goalkeeping: ["saves"],
  general: [
    "touches",
    "fouls",
    "was_fouled",
    "offsides",
    "yellow_cards",
    "red_cards",
    "possession_lost",
  ],
};

function finite(value) {
  if (value == null || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function fixtureRound(rawFixture) {
  const match = String(rawFixture?.league?.round || "").match(/(\d+)\s*$/);
  return match ? Number(match[1]) : null;
}

function isFinished(rawFixture) {
  return new Set(["FT", "AET", "PEN"]).has(
    String(rawFixture?.fixture?.status?.short || "").toUpperCase()
  );
}

async function readJson(filePath, fallback) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJsonIfChanged(filePath, value) {
  const next = `${JSON.stringify(value, null, 2)}\n`;
  const current = await fs.readFile(filePath, "utf8").catch(() => null);
  if (current === next) return false;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, next, "utf8");
  return true;
}

let quotaLogged = false;
async function apiGet(pathname) {
  if (!apiKey) throw new Error("Missing TSAPI_KEY environment variable.");
  const response = await fetch(`${BASE_URL}${pathname}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!quotaLogged) {
    const remaining = response.headers.get("x-monthly-quota-remaining");
    const limit = response.headers.get("x-monthly-quota-limit");
    if (remaining != null || limit != null) {
      console.log(`TheStatsAPI monthly quota: ${remaining ?? "?"}/${limit ?? "?"} remaining`);
    }
    quotaLogged = true;
  }

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`TheStatsAPI ${response.status} for ${pathname}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text);
}

function normalizePlayer(row) {
  const normalized = {
    playerId: String(row?.player_id || ""),
    playerName: String(row?.player_name || "Unknown player"),
    teamId: String(row?.team_id || ""),
    position: row?.position ? String(row.position) : null,
    rating: finite(row?.rating),
    minutesPlayed: finite(row?.minutes_played),
    started: Boolean(row?.started),
    played: Boolean(row?.played),
  };

  for (const [group, fields] of Object.entries(GROUP_FIELDS)) {
    normalized[group] = {};
    for (const field of fields) normalized[group][field] = finite(row?.[group]?.[field]);
  }

  return normalized;
}

function createAccumulator(player, teamSlug) {
  const stats = {};
  const coverage = {};
  for (const [group, fields] of Object.entries(GROUP_FIELDS)) {
    stats[group] = Object.fromEntries(fields.map((field) => [field, 0]));
    coverage[group] = Object.fromEntries(fields.map((field) => [field, 0]));
  }

  return {
    playerId: player.playerId,
    playerName: player.playerName,
    position: player.position,
    teamSlug,
    appearances: 0,
    starts: 0,
    minutes: 0,
    ratingTotal: 0,
    ratingMatches: 0,
    stats,
    coverage,
  };
}

function addAppearance(acc, player) {
  acc.playerName = player.playerName || acc.playerName;
  acc.position = player.position || acc.position;
  if (player.played || (player.minutesPlayed ?? 0) > 0) acc.appearances += 1;
  if (player.started) acc.starts += 1;
  if (player.minutesPlayed != null) acc.minutes += player.minutesPlayed;
  if (player.rating != null) {
    acc.ratingTotal += player.rating;
    acc.ratingMatches += 1;
  }

  for (const [group, fields] of Object.entries(GROUP_FIELDS)) {
    for (const field of fields) {
      const value = player[group]?.[field];
      if (value == null) continue;
      acc.stats[group][field] += value;
      acc.coverage[group][field] += 1;
    }
  }
}

function percentage(numerator, denominator) {
  return denominator > 0 ? round((numerator / denominator) * 100, 1) : null;
}

function per90(value, minutes) {
  return minutes > 0 ? round((value * 90) / minutes, 2) : null;
}

function normalizeName(value) {
  return String(value || "")
    .replace(/ø/gi, "o")
    .replace(/ß/g, "ss")
    .replace(/đ/gi, "d")
    .replace(/ł/gi, "l")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function editDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function findEventPlayer(eventName, candidates) {
  const eventTokens = normalizeName(eventName).split(/\s+/).filter(Boolean);
  if (!eventTokens.length) return null;
  const normalizedEvent = eventTokens.join(" ");
  const exact = candidates.filter(
    (player) => normalizeName(player.playerName) === normalizedEvent
  );
  if (exact.length === 1) return exact[0];

  const eventFirst = eventTokens[0];
  const eventLast = eventTokens.at(-1);
  const surnameMatches = candidates.filter((player) => {
    const tokens = normalizeName(player.playerName).split(/\s+/).filter(Boolean);
    const firstMatches = eventFirst.length === 1
      ? tokens.some((token) => token.startsWith(eventFirst))
      : tokens[0] === eventFirst;
    return firstMatches && tokens.includes(eventLast);
  });
  if (surnameMatches.length === 1) return surnameMatches[0];

  const uniqueSurname = candidates.filter((player) => {
    const tokens = normalizeName(player.playerName).split(/\s+/).filter(Boolean);
    return tokens.includes(eventLast);
  });
  if (uniqueSurname.length === 1) return uniqueSurname[0];

  const fuzzySurname = candidates.filter((player) => {
    const tokens = normalizeName(player.playerName).split(/\s+/).filter(Boolean);
    const firstMatches = eventFirst.length === 1 && tokens[0]?.startsWith(eventFirst);
    return firstMatches && tokens.some((token) => editDistance(token, eventLast) <= 1);
  });
  return fuzzySurname.length === 1 ? fuzzySurname[0] : null;
}

function reconcileFixtureScoring(fixture, cached, fixtureEvents, matchCacheEntry) {
  const apiTeamSlugs = new Map([
    [String(fixture?.teams?.home?.id || ""), matchCacheEntry?.homeTeam || null],
    [String(fixture?.teams?.away?.id || ""), matchCacheEntry?.awayTeam || null],
  ]);
  const providerTeamIds = new Map(
    Object.entries(cached.teamIds || {}).map(([teamId, teamSlug]) => [teamSlug, teamId])
  );
  const goals = new Map();
  const assists = new Map();
  const unresolvedGoals = [];
  const unresolvedAssists = [];
  let completedGoalEvents = 0;

  for (const event of fixtureEvents) {
    if (String(event?.type || "").toLowerCase() !== "goal") continue;
    const detail = String(event?.detail || "").toLowerCase();
    if (detail.includes("missed penalty")) continue;
    completedGoalEvents += 1;
    if (detail.includes("own goal")) continue;

    const teamSlug = apiTeamSlugs.get(String(event?.team?.id || ""));
    const providerTeamId = providerTeamIds.get(teamSlug);
    const candidates = (cached.players || []).filter(
      (player) => player.teamId === providerTeamId
    );
    const scorer = findEventPlayer(event?.player?.name, candidates);
    if (!scorer) {
      unresolvedGoals.push(event?.player?.name || "Unknown scorer");
    } else {
      goals.set(scorer.playerId, (goals.get(scorer.playerId) || 0) + 1);
    }

    if (event?.assist?.name) {
      const assister = findEventPlayer(event.assist.name, candidates);
      if (!assister) {
        unresolvedAssists.push(event.assist.name);
      } else {
        assists.set(assister.playerId, (assists.get(assister.playerId) || 0) + 1);
      }
    }
  }

  const fixtureId = String(fixture?.fixture?.id || cached.fixtureId || "");
  const expectedGoals = Number(fixture?.goals?.home || 0) + Number(fixture?.goals?.away || 0);
  if (completedGoalEvents !== expectedGoals) {
    const coverageWarning = `incomplete goal events (${completedGoalEvents}/${expectedGoals})`;
    unresolvedGoals.push(coverageWarning);
    unresolvedAssists.push(coverageWarning);
  }
  if (unresolvedGoals.length) {
    console.warn(
      `Could not reconcile API-Football scorers for fixture ${fixtureId}: ` +
      `${unresolvedGoals.join(", ")}. Keeping TSAPI goal values.`
    );
  }
  if (unresolvedAssists.length) {
    console.warn(
      `Could not reconcile API-Football assists for fixture ${fixtureId}: ` +
      `${unresolvedAssists.join(", ")}. Keeping TSAPI assist values.`
    );
  }

  let goalMismatches = 0;
  let assistMismatches = 0;
  const players = (cached.players || []).map((player) => {
    const eventGoals = goals.get(player.playerId) || 0;
    const eventAssists = assists.get(player.playerId) || 0;
    const providerGoals = player.shooting?.goals ?? 0;
    const providerAssists = player.passing?.assists ?? 0;
    if (!unresolvedGoals.length && eventGoals !== providerGoals) {
      goalMismatches += 1;
      console.warn(
        `Goal mismatch fixture ${fixtureId}, ${player.playerName}: ` +
        `API-Football ${eventGoals}, TSAPI ${providerGoals}.`
      );
    }
    if (!unresolvedAssists.length && eventAssists !== providerAssists) {
      assistMismatches += 1;
      console.warn(
        `Assist mismatch fixture ${fixtureId}, ${player.playerName}: ` +
        `API-Football ${eventAssists}, TSAPI ${providerAssists}.`
      );
    }
    return {
      ...player,
      shooting: {
        ...player.shooting,
        goals: unresolvedGoals.length ? player.shooting?.goals : eventGoals,
      },
      passing: {
        ...player.passing,
        assists: unresolvedAssists.length ? player.passing?.assists : eventAssists,
      },
    };
  });

  return { players, goalMismatches, assistMismatches };
}

function finalizeAccumulator(acc) {
  const { stats } = acc;
  const completeTotal = (group, field) =>
    acc.appearances > 0 && acc.coverage[group][field] >= acc.appearances
      ? stats[group][field]
      : null;
  const xg = completeTotal("shooting", "expected_goals");
  const xa = completeTotal("shooting", "expected_assists");
  const npxg = completeTotal("shooting", "np_expected_goals");
  return {
    playerId: acc.playerId,
    playerName: acc.playerName,
    position: acc.position,
    ...(acc.teamSlug ? { teamSlug: acc.teamSlug } : {}),
    appearances: acc.appearances,
    starts: acc.starts,
    minutes: Math.round(acc.minutes),
    playerRating: acc.ratingMatches ? round(acc.ratingTotal / acc.ratingMatches, 2) : null,
    scoring: {
      goals: stats.shooting.goals,
      assists: stats.passing.assists,
      goalContributions: stats.shooting.goals + stats.passing.assists,
      xg: round(xg),
      xa: round(xa),
      npxg: round(npxg),
      goalsPer90: per90(stats.shooting.goals, acc.minutes),
      assistsPer90: per90(stats.passing.assists, acc.minutes),
      xgPer90: xg == null ? null : per90(xg, acc.minutes),
      xaPer90: xa == null ? null : per90(xa, acc.minutes),
      bigChancesCreated: stats.shooting.big_chances_created,
    },
    shooting: {
      shots: stats.shooting.total_shots,
      shotsOnTarget: stats.shooting.shots_on_target,
      shotsOffTarget: stats.shooting.shots_off_target,
      blockedShots: stats.shooting.blocked_shots,
      shotAccuracy: percentage(stats.shooting.shots_on_target, stats.shooting.total_shots),
      goalConversion: percentage(stats.shooting.goals, stats.shooting.total_shots),
    },
    passing: {
      passes: stats.passing.total_passes,
      accuratePasses: stats.passing.accurate_passes,
      passAccuracy: percentage(stats.passing.accurate_passes, stats.passing.total_passes),
      keyPasses: stats.passing.key_passes,
      crosses: stats.passing.total_crosses,
      accurateCrosses: stats.passing.accurate_crosses,
      longBalls: stats.passing.total_long_balls,
      accurateLongBalls: stats.passing.accurate_long_balls,
    },
    defending: {
      tackles: stats.defending.tackles,
      interceptions: stats.defending.interceptions,
      clearances: stats.defending.clearances,
      ballRecoveries: stats.defending.ball_recoveries,
    },
    duels: {
      won: stats.duels.duel_won,
      lost: stats.duels.duel_lost,
      winPercentage: percentage(
        stats.duels.duel_won,
        stats.duels.duel_won + stats.duels.duel_lost
      ),
      aerialWon: stats.duels.aerial_won,
      successfulDribbles: stats.duels.won_contest,
      dispossessed: stats.duels.dispossessed,
    },
    goalkeeping: { saves: stats.goalkeeping.saves },
    discipline: {
      fouls: stats.general.fouls,
      foulsWon: stats.general.was_fouled,
      offsides: stats.general.offsides,
      yellowCards: stats.general.yellow_cards,
      redCards: stats.general.red_cards,
    },
  };
}

function compactTeamStats(row) {
  return {
    playerId: row.playerId,
    playerName: row.playerName,
    position: row.position,
    teamSlug: row.teamSlug,
    appearances: row.appearances,
    starts: row.starts,
    minutes: row.minutes,
    playerRating: row.playerRating,
    scoring: {
      goals: row.scoring.goals,
      assists: row.scoring.assists,
      xg: row.scoring.xg,
      xa: row.scoring.xa,
    },
    shooting: { shots: row.shooting.shots },
    passing: { keyPasses: row.passing.keyPasses },
    defending: {
      tackles: row.defending.tackles,
      interceptions: row.defending.interceptions,
    },
    goalkeeping: { saves: row.goalkeeping.saves },
    discipline: { yellowCards: row.discipline.yellowCards },
  };
}

async function buildAggregate(finishedFixtures, events, matchCache) {
  const leaguePlayers = new Map();
  const teamPlayers = new Map();
  const latestTeamByPlayer = new Map();
  const eventsByFixture = new Map();
  for (const event of events) {
    const fixtureId = String(event?.fixtureId || "");
    if (!eventsByFixture.has(fixtureId)) eventsByFixture.set(fixtureId, []);
    eventsByFixture.get(fixtureId).push(event);
  }
  let matchesIncluded = 0;
  let latestFetchedAt = null;
  let goalMismatches = 0;
  let assistMismatches = 0;

  for (const fixture of finishedFixtures) {
    const fixtureId = String(fixture?.fixture?.id || "");
    const cached = await readJson(path.join(playerMatchDir, `${fixtureId}.json`), null);
    if (!cached?.players?.length) continue;
    const reconciled = reconcileFixtureScoring(
      fixture,
      cached,
      eventsByFixture.get(fixtureId) || [],
      matchCache?.fixtures?.[fixtureId]
    );
    goalMismatches += reconciled.goalMismatches;
    assistMismatches += reconciled.assistMismatches;
    matchesIncluded += 1;
    if (cached.fetchedAt && (!latestFetchedAt || cached.fetchedAt > latestFetchedAt)) {
      latestFetchedAt = cached.fetchedAt;
    }

    for (const player of reconciled.players) {
      const teamSlug = cached.teamIds?.[player.teamId];
      if (!player.playerId || !teamSlug) continue;

      if (player.played || (player.minutesPlayed ?? 0) > 0) {
        const appearanceAt = cached.kickoff || fixture?.fixture?.date || "";
        const latestTeam = latestTeamByPlayer.get(player.playerId);
        if (!latestTeam || appearanceAt >= latestTeam.appearanceAt) {
          latestTeamByPlayer.set(player.playerId, { appearanceAt, teamSlug });
        }
      }

      if (!leaguePlayers.has(player.playerId)) {
        leaguePlayers.set(player.playerId, createAccumulator(player, null));
      }
      addAppearance(leaguePlayers.get(player.playerId), player);

      const teamKey = `${teamSlug}:${player.playerId}`;
      if (!teamPlayers.has(teamKey)) {
        teamPlayers.set(teamKey, createAccumulator(player, teamSlug));
      }
      addAppearance(teamPlayers.get(teamKey), player);
    }
  }

  const teamStatsByPlayer = new Map();
  for (const acc of teamPlayers.values()) {
    const row = finalizeAccumulator(acc);
    if (!row.appearances) continue;
    if (!teamStatsByPlayer.has(row.playerId)) teamStatsByPlayer.set(row.playerId, []);
    teamStatsByPlayer.get(row.playerId).push(compactTeamStats(row));
  }

  const players = [...leaguePlayers.values()]
    .map((acc) => {
      const teamStats = teamStatsByPlayer.get(acc.playerId) || [];
      const teamSlugs = teamStats.map((row) => row.teamSlug);
      return {
        ...finalizeAccumulator(acc),
        currentTeamSlug: latestTeamByPlayer.get(acc.playerId)?.teamSlug || teamSlugs.at(-1) || null,
        teamSlugs,
        teamStats,
      };
    })
    .filter((player) => player.appearances > 0)
    .sort((a, b) => b.minutes - a.minutes || a.playerName.localeCompare(b.playerName));

  return {
    version: 2,
    source: "api-football+thestatsapi",
    scoringSource: "api-football-events",
    seasonPath: season.seasonPath,
    updatedAt: latestFetchedAt,
    matchesIncluded,
    reconciliation: { goalMismatches, assistMismatches },
    qualification: {
      per90Minutes: 180,
      conversionShots: 10,
      passAccuracyPasses: 100,
      duelPercentageDuels: 10,
      goalkeeperAppearances: 3,
    },
    players,
  };
}

async function main() {
  if (!season.theStatsApiCompetitionId || !season.theStatsApiSeasonId) {
    console.log(`No TheStatsAPI season configured for ${season.seasonPath}; skipping player stats.`);
    return;
  }

  const fixturesPayload = await readJson(fixturesPath, null);
  const eventsPayload = await readJson(eventsPath, { response: [] });
  const matchCache = await readJson(matchCachePath, { fixtures: {} });
  const finishedFixtures = (fixturesPayload?.response || []).filter(isFinished);
  const latestFinishedRound = Math.max(0, ...finishedFixtures.map(fixtureRound).filter(Number.isFinite));
  const matchesByRound = new Map();
  let fetched = 0;
  let changed = 0;

  async function matchForFixture(rawFixture, matchId) {
    const round = fixtureRound(rawFixture);
    if (!matchesByRound.has(round)) {
      const params = new URLSearchParams({
        competition_id: season.theStatsApiCompetitionId,
        season_id: season.theStatsApiSeasonId,
        matchday: String(round),
        per_page: "100",
      });
      const payload = await apiGet(`/football/matches?${params}`);
      matchesByRound.set(round, Array.isArray(payload?.data) ? payload.data : []);
    }
    return matchesByRound.get(round).find((match) => String(match?.id) === String(matchId)) || null;
  }

  for (const rawFixture of finishedFixtures) {
    const fixtureId = String(rawFixture?.fixture?.id || "");
    if (onlyFixtureId && fixtureId !== onlyFixtureId) continue;

    const cacheFile = path.join(playerMatchDir, `${fixtureId}.json`);
    const existing = await readJson(cacheFile, null);
    const round = fixtureRound(rawFixture);
    const shouldRefresh = !existing || (refreshLatest && round === latestFinishedRound);
    if (!shouldRefresh) continue;

    const matchId = matchCache?.fixtures?.[fixtureId]?.matchId;
    if (!matchId) {
      console.warn(`No TheStatsAPI match ID cached for fixture ${fixtureId}; skipping.`);
      continue;
    }

    const providerMatch = await matchForFixture(rawFixture, matchId);
    const homeTeamId = String(providerMatch?.home_team?.id || "");
    const awayTeamId = String(providerMatch?.away_team?.id || "");
    if (!homeTeamId || !awayTeamId) {
      console.warn(`Could not resolve TheStatsAPI team IDs for fixture ${fixtureId}; skipping.`);
      continue;
    }

    const payload = await apiGet(
      `/football/matches/${encodeURIComponent(matchId)}/player-stats`
    );
    const players = (Array.isArray(payload?.data) ? payload.data : [])
      .map(normalizePlayer)
      .filter((player) => player.playerId && player.teamId);
    fetched += 1;

    const nextCore = {
      fixtureId,
      matchId: String(matchId),
      round,
      kickoff: rawFixture?.fixture?.date || null,
      teamIds: {
        [homeTeamId]: matchCache.fixtures[fixtureId]?.homeTeam || null,
        [awayTeamId]: matchCache.fixtures[fixtureId]?.awayTeam || null,
      },
      players,
    };
    const existingCore = existing ? { ...existing, fetchedAt: undefined } : null;
    if (existingCore && JSON.stringify(existingCore) === JSON.stringify(nextCore)) {
      console.log(`Player stats unchanged: fixture ${fixtureId}`);
      continue;
    }

    const next = { ...nextCore, fetchedAt: new Date().toISOString() };
    await writeJsonIfChanged(cacheFile, next);
    changed += 1;
    console.log(`Player stats ${fixtureId}: ${players.length} players`);
  }

  const aggregate = await buildAggregate(
    finishedFixtures,
    eventsPayload?.response || [],
    matchCache
  );
  const aggregateChanged = await writeJsonIfChanged(aggregatePath, aggregate);
  console.log(
    `Player stats complete: ${fetched} fetched, ${changed} match caches changed, ` +
    `${aggregate.matchesIncluded} matches aggregated, ${aggregate.players.length} players.`
  );
  console.log(`${aggregateChanged ? "Wrote" : "Unchanged"}: ${aggregatePath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
