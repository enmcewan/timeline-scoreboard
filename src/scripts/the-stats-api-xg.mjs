import fs from "node:fs/promises";
import path from "node:path";

const BASE_URL = "https://api.thestatsapi.com/api";
const PRE_MATCH_MS = 10 * 60 * 1000;
const POST_MATCH_MS = 195 * 60 * 1000;
const KICKOFF_TOLERANCE_MS = 30 * 60 * 1000;

function finiteXg(value) {
  if (value == null || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0
    ? Number(number.toFixed(2))
    : null;
}

function finiteStat(value) {
  if (value == null || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function hasInsights(insights) {
  return Object.values(insights || {}).some(
    (pair) => finiteStat(pair?.home) != null && finiteStat(pair?.away) != null
  );
}

function hasShotMap(shotMap) {
  return Array.isArray(shotMap?.shots) && shotMap.shots.length > 0;
}

function finiteCoordinate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : null;
}

export function extractTheStatsApiShotMap(payload) {
  const shots = Array.isArray(payload?.data) ? payload.data : [];
  const homeTeamId = String(payload?.event?.home_team_id || "");
  const awayTeamId = String(payload?.event?.away_team_id || "");
  const normalized = shots.flatMap((shot) => {
    const x = finiteCoordinate(shot?.x);
    const y = finiteCoordinate(shot?.y);
    if (x == null || y == null) return [];

    const teamId = String(shot?.team_id || "");
    const side = teamId === homeTeamId ? "home" : teamId === awayTeamId ? "away" : null;
    if (!side) return [];

    return [{
      id: String(shot?.id || ""),
      side,
      playerId: String(shot?.player_id || ""),
      playerName: String(shot?.player_name || "Unknown player"),
      teamName: String(shot?.team_name || ""),
      x,
      y,
      minute: finiteStat(shot?.minute),
      result: String(shot?.result || "unknown").toLowerCase(),
      xg: finiteXg(shot?.expected_goals),
      situation: shot?.situation ? String(shot.situation) : null,
      bodyPart: shot?.body_part ? String(shot.body_part) : null,
      isGoal: Boolean(shot?.is_goal),
      isOnTarget: Boolean(shot?.is_on_target),
      isBlocked: Boolean(shot?.is_blocked_shot),
      isPenalty: Boolean(shot?.is_penalty),
    }];
  });

  if (!normalized.length) return null;
  return {
    matchId: String(payload?.match_id || payload?.event?.id || ""),
    shots: normalized,
    npXg: {
      home: finiteXg(payload?.np_xg_summary?.stored?.home_team ?? payload?.np_xg_summary?.live?.home_team),
      away: finiteXg(payload?.np_xg_summary?.stored?.away_team ?? payload?.np_xg_summary?.live?.away_team),
    },
    isFinal: Boolean(payload?.meta?.is_final),
  };
}

function statPair(payload, paths) {
  for (const keys of paths) {
    let value = payload;
    for (const key of keys) value = value?.[key];

    const all = value?.all;
    const home = finiteStat(all?.home);
    const away = finiteStat(all?.away);
    if (home != null && away != null) return { home, away };
  }

  return null;
}

export function extractTheStatsApiInsights(payload) {
  const roots = [payload?.data?.stats, payload?.data].filter(Boolean);
  const fields = {
    bigChances: [["overview", "big_chances"]],
    bigChancesMissed: [["attack", "big_chances_missed"]],
    hitWoodwork: [["shots", "hit_woodwork"]],
    tackles: [["overview", "tackles"]],
    accuratePasses: [
      ["passes", "accurate_passes"],
      ["overview", "accurate_passes"],
    ],
    duelsWonPct: [["duels", "duels_won_percentage"]],
    offsides: [["attack", "offsides"]],
    interceptions: [["defending", "interceptions"]],
    clearances: [["defending", "clearances"]],
    goalkeeperSaves: [
      ["goalkeeping", "saves"],
      ["overview", "goalkeeper_saves"],
    ],
  };
  const insights = {};

  for (const [name, paths] of Object.entries(fields)) {
    for (const root of roots) {
      const pair = statPair(root, paths);
      if (!pair) continue;
      insights[name] = pair;
      break;
    }
  }

  return insights;
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\b(afc|fc|football club)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function buildTeamAliasMap(teams) {
  const aliases = new Map();

  for (const [slug, team] of Object.entries(teams || {})) {
    for (const name of [team?.name, team?.display, ...(team?.altNames || [])]) {
      const normalized = normalizeName(name);
      if (normalized) aliases.set(normalized, slug);
    }
  }

  return aliases;
}

function canonicalTeam(name, aliases) {
  const normalized = normalizeName(name);
  return aliases.get(normalized) || normalized;
}

function fixtureKickoff(rawFixture) {
  const timestamp = Number(rawFixture?.fixture?.timestamp);
  if (Number.isFinite(timestamp) && timestamp > 0) return timestamp * 1000;
  return Date.parse(rawFixture?.fixture?.date || "");
}

function fixtureRound(rawFixture) {
  const match = String(rawFixture?.league?.round || "").match(/(\d+)\s*$/);
  return match ? Number(match[1]) : null;
}

function isDeadFixture(rawFixture) {
  return new Set(["PST", "CANC", "ABD", "SUSP", "INT", "WO", "TBD"]).has(
    String(rawFixture?.fixture?.status?.short || "").toUpperCase()
  );
}

function isFinishedFixture(rawFixture) {
  return new Set(["FT", "AET", "PEN"]).has(
    String(rawFixture?.fixture?.status?.short || "").toUpperCase()
  );
}

function isInsideLiveWindow(rawFixture, nowMs) {
  if (isDeadFixture(rawFixture)) return false;
  const kickoff = fixtureKickoff(rawFixture);
  return (
    Number.isFinite(kickoff) &&
    nowMs >= kickoff - PRE_MATCH_MS &&
    nowMs <= kickoff + POST_MATCH_MS
  );
}

function hasXg(entry) {
  return finiteXg(entry?.home) != null && finiteXg(entry?.away) != null;
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

export function applyTheStatsApiXg(match, xg) {
  if (!match || !hasXg(xg)) return false;

  match.statistics = {
    home: { ...(match.statistics?.home || {}), xg: finiteXg(xg.home) },
    away: { ...(match.statistics?.away || {}), xg: finiteXg(xg.away) },
    xgProvider: "thestatsapi",
  };
  return true;
}

export function applyTheStatsApiMatchData(match, data) {
  if (!match || !data) return false;

  let applied = applyTheStatsApiXg(match, data.xg);
  if (hasInsights(data.insights)) {
    match.insights = {
      provider: "thestatsapi",
      ...data.insights,
    };
    applied = true;
  }
  if (hasShotMap(data.shotMap)) {
    match.shotMap = {
      provider: "thestatsapi",
      ...data.shotMap,
    };
    applied = true;
  }

  return applied;
}

export async function createTheStatsApiXgClient({
  apiKey = process.env.TSAPI_KEY,
  competitionId,
  seasonId,
  seasonPath,
  cachePath,
  teams,
  now = () => Date.now(),
}) {
  const aliases = buildTeamAliasMap(teams);
  const cache = await readJson(cachePath, {
    version: 3,
    source: "thestatsapi",
    seasonPath,
    updatedAt: null,
    fixtures: {},
  });
  cache.version = 3;
  cache.fixtures ||= {};

  const matchesByRound = new Map();
  let dirty = false;
  let quotaLogged = false;

  async function apiGet(pathname) {
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

    const body = await response.text();
    if (!response.ok) {
      const error = new Error(
        `TheStatsAPI ${response.status} for ${pathname}: ${body.slice(0, 300)}`
      );
      error.status = response.status;
      throw error;
    }

    return JSON.parse(body);
  }

  async function matchesForRound(round) {
    if (matchesByRound.has(round)) return matchesByRound.get(round);

    const params = new URLSearchParams({
      competition_id: competitionId,
      season_id: seasonId,
      matchday: String(round),
      per_page: "100",
    });
    const payload = await apiGet(`/football/matches?${params}`);
    const matches = Array.isArray(payload?.data) ? payload.data : [];
    matchesByRound.set(round, matches);
    return matches;
  }

  async function resolveMatch(rawFixture) {
    const fixtureId = String(rawFixture?.fixture?.id || "");
    const cached = cache.fixtures[fixtureId];
    if (cached?.matchId) return cached.matchId;

    const round = fixtureRound(rawFixture);
    if (!round) throw new Error(`Cannot resolve TheStatsAPI matchday for fixture ${fixtureId}`);

    const home = canonicalTeam(rawFixture?.teams?.home?.name, aliases);
    const away = canonicalTeam(rawFixture?.teams?.away?.name, aliases);
    const kickoff = fixtureKickoff(rawFixture);
    const teamCandidates = (await matchesForRound(round)).filter((match) =>
        canonicalTeam(match?.home_team?.name, aliases) === home &&
        canonicalTeam(match?.away_team?.name, aliases) === away
    );
    const candidates = teamCandidates.filter((match) => {
      const otherKickoff = Date.parse(match?.utc_date || "");
      return (
        Number.isFinite(kickoff) &&
        Number.isFinite(otherKickoff) &&
        Math.abs(kickoff - otherKickoff) <= KICKOFF_TOLERANCE_MS
      );
    });

    // An exact home/away pair within one league round remains unambiguous when
    // a fixture is rescheduled and one provider still has the old kickoff.
    const resolvedCandidates = candidates.length === 1 ? candidates : teamCandidates;

    if (resolvedCandidates.length !== 1) {
      throw new Error(
        `Expected one TheStatsAPI match for ${home} vs ${away} [MW ${round}], found ${resolvedCandidates.length}`
      );
    }

    const matchedKickoff = Date.parse(resolvedCandidates[0]?.utc_date || "");
    if (
      Number.isFinite(kickoff) &&
      Number.isFinite(matchedKickoff) &&
      Math.abs(kickoff - matchedKickoff) > KICKOFF_TOLERANCE_MS
    ) {
      console.warn(
        `TheStatsAPI matched rescheduled fixture ${fixtureId}: ${rawFixture?.fixture?.date} -> ${resolvedCandidates[0].utc_date}`
      );
    }

    const matchId = String(resolvedCandidates[0].id);
    cache.fixtures[fixtureId] = {
      ...(cached || {}),
      matchId,
      kickoff: rawFixture?.fixture?.date || null,
      homeTeam: home,
      awayTeam: away,
    };
    dirty = true;
    return matchId;
  }

  function extractXg(payload) {
    const all =
      payload?.data?.stats?.expected_goals?.all ??
      payload?.data?.overview?.expected_goals?.all ??
      payload?.data?.expected_goals?.all;
    return { home: finiteXg(all?.home), away: finiteXg(all?.away) };
  }

  function cachedMatchData(entry) {
    if (!entry) return null;
    const data = {
      xg: hasXg(entry.xg) ? entry.xg : null,
      insights: hasInsights(entry.insights) ? entry.insights : null,
      shotMap: hasShotMap(entry.shotMap) ? entry.shotMap : null,
    };
    return data.xg || data.insights || data.shotMap ? data : null;
  }

  async function fetchStats(matchId, endpoint, { allowConflictFallback }) {
    try {
      return {
        payload: await apiGet(
          `/football/matches/${encodeURIComponent(matchId)}/${endpoint}`
        ),
        endpoint,
      };
    } catch (error) {
      if (!allowConflictFallback || error?.status !== 409) throw error;

      const fallbackEndpoint = endpoint === "live-stats" ? "stats" : "live-stats";
      console.warn(
        `TheStatsAPI ${endpoint} conflicted with provider status; trying ${fallbackEndpoint}.`
      );
      return {
        payload: await apiGet(
          `/football/matches/${encodeURIComponent(matchId)}/${fallbackEndpoint}`
        ),
        endpoint: fallbackEndpoint,
      };
    }
  }

  async function getMatchData(rawFixture, { force = false, final = false } = {}) {
    const fixtureId = String(rawFixture?.fixture?.id || "");
    const cached = cache.fixtures[fixtureId];

    if (!apiKey || !competitionId || !seasonId) {
      return cachedMatchData(cached);
    }

    if (!force && !isInsideLiveWindow(rawFixture, now())) {
      return cachedMatchData(cached);
    }

    if (!force && !isFinishedFixture(rawFixture)) {
      const kickoff = fixtureKickoff(rawFixture);
      if (Number.isFinite(kickoff) && now() < kickoff) {
        return cachedMatchData(cached);
      }
    }

    try {
      const matchId = await resolveMatch(rawFixture);
      const requestedEndpoint = final || isFinishedFixture(rawFixture)
        ? "stats"
        : "live-stats";
      const [statsResult, shotMapResult] = await Promise.allSettled([
        fetchStats(matchId, requestedEndpoint, { allowConflictFallback: !final }),
        apiGet(`/football/matches/${encodeURIComponent(matchId)}/shotmap`),
      ]);
      if (statsResult.status === "rejected") {
        console.warn(`TheStatsAPI match stats failed for fixture ${fixtureId}: ${statsResult.reason?.message || statsResult.reason}`);
      }
      if (shotMapResult.status === "rejected") {
        console.warn(`TheStatsAPI shot map failed for fixture ${fixtureId}: ${shotMapResult.reason?.message || shotMapResult.reason}`);
      }

      const result = statsResult.status === "fulfilled" ? statsResult.value : null;
      const extractedXg = result ? extractXg(result.payload) : null;
      const extractedInsights = result ? extractTheStatsApiInsights(result.payload) : null;
      const extractedShotMap = shotMapResult.status === "fulfilled"
        ? extractTheStatsApiShotMap(shotMapResult.value)
        : null;
      const xg = hasXg(extractedXg) ? extractedXg : cached?.xg;
      const insights = {
        ...(cached?.insights || {}),
        ...(extractedInsights || {}),
      };
      const shotMap = hasShotMap(extractedShotMap) ? extractedShotMap : cached?.shotMap;
      delete insights.tacklesWonPct;
      delete insights.shotsBlocked;

      if (!hasXg(xg) && !hasInsights(insights) && !hasShotMap(shotMap)) {
        console.log(`TheStatsAPI match stats not yet available for fixture ${fixtureId}.`);
        return cachedMatchData(cached);
      }

      cache.fixtures[fixtureId] = {
        ...cache.fixtures[fixtureId],
        ...(hasXg(xg) ? { xg } : {}),
        ...(hasInsights(insights) ? { insights } : {}),
        ...(hasShotMap(shotMap) ? { shotMap } : {}),
        fetchedAt: new Date(now()).toISOString(),
        matchStatus: rawFixture?.fixture?.status?.short || null,
        xgPhase: result?.endpoint === "stats" ? "final" : cached?.xgPhase || "live",
      };
      dirty = true;
      console.log(
        `TheStatsAPI ${result?.endpoint || requestedEndpoint} data ${fixtureId}: ` +
        `xG ${hasXg(xg) ? `${xg.home} / ${xg.away}` : "unavailable"}; ` +
        `insights ${hasInsights(insights) ? Object.keys(insights).length : 0}; ` +
        `shots ${hasShotMap(shotMap) ? shotMap.shots.length : 0}`
      );
      return {
        xg: hasXg(xg) ? xg : null,
        insights: hasInsights(insights) ? insights : null,
        shotMap: hasShotMap(shotMap) ? shotMap : null,
      };
    } catch (error) {
      console.warn(`TheStatsAPI stats failed for fixture ${fixtureId}: ${error.message}`);
      return cachedMatchData(cached);
    }
  }

  async function getXg(rawFixture, options) {
    return (await getMatchData(rawFixture, options))?.xg ?? null;
  }

  async function save() {
    if (!dirty) return false;
    cache.updatedAt = new Date(now()).toISOString();
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
    return true;
  }

  return { getMatchData, getXg, save };
}
