import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getSeasonConfigFromEnv } from "../config/seasons.js";

const API_KEY = process.env.APIFOOTBALL_KEY;
const season = getSeasonConfigFromEnv();
const LEAGUE = season.apiLeagueId;
const SEASON = season.apiSeason;
const BET_MATCH_WINNER = 1;
const LOOKAHEAD_DAYS = Number(process.env.ODDS_LOOKAHEAD_DAYS || 7);

if (!API_KEY) {
  console.error("Missing APIFOOTBALL_KEY env var (APIFOOTBALL_KEY)");
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");
const seasonDataDir = path.join(
  projectRoot,
  "public",
  "data",
  "leagues",
  season.leagueKey,
  season.seasonPath
);
const fixturesPath = path.join(seasonDataDir, "fixtures.raw.json");
const oddsPath = path.join(seasonDataDir, "odds.json");

function readJsonIfExists(filePath, fallback) {
  try {
    const text = fs.readFileSync(filePath, "utf8");
    return JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (err) {
    if (err?.code === "ENOENT") return fallback;
    throw err;
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
  console.log(`Wrote: ${filePath}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientApiError(err) {
  const msg = String(err?.message || err).toLowerCase();
  return (
    msg.includes("503") ||
    msg.includes("502") ||
    msg.includes("504") ||
    msg.includes("429") ||
    msg.includes("timeout") ||
    msg.includes("econnreset") ||
    msg.includes("socket hang up")
  );
}

async function fetchWithRetry(fn, { tries = 5, baseDelayMs = 750 } = {}) {
  let lastErr;

  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransientApiError(err) || attempt === tries) throw err;

      const jitter = Math.floor(Math.random() * 250);
      const delay = baseDelayMs * Math.pow(2, attempt - 1) + jitter;
      console.warn(`Transient API error (attempt ${attempt}/${tries}): ${String(err?.message || err)}`);
      console.warn(`Retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }

  throw lastErr;
}

function validateApiPayload(json) {
  if (json?.errors && Object.keys(json.errors).length) {
    const msg = Object.entries(json.errors)
      .map(([k, v]) => `${k}: ${v}`)
      .join(" | ");
    throw new Error(`API returned error payload: ${msg}`);
  }

  if (!Array.isArray(json?.response)) {
    throw new Error("API returned no response array.");
  }
}

async function fetchJson(url) {
  console.log(`Fetching: ${url}`);

  const res = await fetch(url, {
    headers: {
      "x-apisports-key": API_KEY,
    },
  });

  console.log("HTTP status:", res.status);
  const body = await res.text();

  if (!res.ok) {
    console.error("Error response body:\n", body);
    throw new Error(`HTTP ${res.status} from ${url}`);
  }

  const json = JSON.parse(body);
  validateApiPayload(json);
  return json;
}

function getFixtureId(fixture) {
  return String(fixture?.fixture?.id ?? "");
}

function getKickoffMs(fixture) {
  if (fixture?.fixture?.timestamp) return Number(fixture.fixture.timestamp) * 1000;
  const iso = fixture?.fixture?.date;
  const parsed = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(parsed) ? parsed : NaN;
}

function getStatusShort(fixture) {
  return String(fixture?.fixture?.status?.short ?? "").toUpperCase();
}

function isPreMatchFixture(fixture) {
  return new Set(["NS", "TBD", "PST"]).has(getStatusShort(fixture));
}

function shouldFetchOddsForFixture(fixture, existing, nowMs = Date.now()) {
  const fixtureId = getFixtureId(fixture);
  const kickoffMs = getKickoffMs(fixture);
  if (!fixtureId || !Number.isFinite(kickoffMs)) return false;
  if (!isPreMatchFixture(fixture)) return false;

  const lookaheadMs = LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000;
  if (kickoffMs < nowMs) return false;
  if (kickoffMs > nowMs + lookaheadMs) return false;

  // Pre-match odds can move, so update existing entries until kickoff.
  return !existing?.fixtures?.[fixtureId]?.locked;
}

function decimalOdd(values, label) {
  const item = values.find((v) => String(v?.value || "").toLowerCase() === label);
  const odd = Number(item?.odd);
  return Number.isFinite(odd) && odd > 1 ? odd : null;
}

function impliedFromDecimal(decimal) {
  const raw = {
    home: 1 / decimal.home,
    draw: 1 / decimal.draw,
    away: 1 / decimal.away,
  };
  const total = raw.home + raw.draw + raw.away;
  return {
    home: raw.home / total,
    draw: raw.draw / total,
    away: raw.away / total,
  };
}

function roundToHundred(probabilities) {
  const entries = [
    ["home", probabilities.home * 100],
    ["draw", probabilities.draw * 100],
    ["away", probabilities.away * 100],
  ];
  const floors = entries.map(([key, value]) => ({
    key,
    value,
    floor: Math.floor(value),
    remainder: value - Math.floor(value),
  }));
  let remaining = 100 - floors.reduce((sum, item) => sum + item.floor, 0);

  floors
    .sort((a, b) => b.remainder - a.remainder)
    .forEach((item) => {
      if (remaining > 0) {
        item.floor += 1;
        remaining -= 1;
      }
    });

  return Object.fromEntries(floors.map((item) => [item.key, item.floor]));
}

function normalizeOddsResponse(apiJson, fixture) {
  const response = apiJson.response?.[0];
  const bookmakers = response?.bookmakers ?? [];
  const normalizedBookmakers = [];

  for (const bookmaker of bookmakers) {
    const bet = (bookmaker.bets ?? []).find((b) => Number(b?.id) === BET_MATCH_WINNER);
    const values = bet?.values ?? [];
    const decimal = {
      home: decimalOdd(values, "home"),
      draw: decimalOdd(values, "draw"),
      away: decimalOdd(values, "away"),
    };

    if (!decimal.home || !decimal.draw || !decimal.away) continue;

    const implied = impliedFromDecimal(decimal);

    normalizedBookmakers.push({
      id: bookmaker.id ?? null,
      name: bookmaker.name ?? "",
      decimal,
      implied: {
        home: Number((implied.home * 100).toFixed(2)),
        draw: Number((implied.draw * 100).toFixed(2)),
        away: Number((implied.away * 100).toFixed(2)),
      },
    });
  }

  if (!normalizedBookmakers.length) return null;

  const average = normalizedBookmakers.reduce(
    (acc, bookmaker) => {
      acc.home += bookmaker.implied.home / 100;
      acc.draw += bookmaker.implied.draw / 100;
      acc.away += bookmaker.implied.away / 100;
      return acc;
    },
    { home: 0, draw: 0, away: 0 }
  );

  average.home /= normalizedBookmakers.length;
  average.draw /= normalizedBookmakers.length;
  average.away /= normalizedBookmakers.length;

  return {
    fixtureId: Number(getFixtureId(fixture)),
    fixtureDate: fixture.fixture?.date ?? response?.fixture?.date ?? null,
    market: "Match Winner",
    betId: BET_MATCH_WINNER,
    capturedAt: new Date().toISOString(),
    apiUpdatedAt: response?.update ?? null,
    sourceCount: normalizedBookmakers.length,
    locked: false,
    consensus: roundToHundred(average),
    bookmakers: normalizedBookmakers,
  };
}

async function fetchOddsForFixture(fixtureId) {
  const params = new URLSearchParams({
    league: String(LEAGUE),
    season: String(SEASON),
    fixture: String(fixtureId),
    bet: String(BET_MATCH_WINNER),
  });
  const url = `https://v3.football.api-sports.io/odds?${params}`;
  return fetchWithRetry(() => fetchJson(url), { tries: 5, baseDelayMs: 750 });
}

function lockStartedFixtures(existing, fixtures) {
  const byFixtureId = new Map(fixtures.map((fixture) => [getFixtureId(fixture), fixture]));
  let locked = 0;

  for (const [fixtureId, odds] of Object.entries(existing.fixtures ?? {})) {
    const fixture = byFixtureId.get(String(fixtureId));
    if (!fixture || isPreMatchFixture(fixture) || odds.locked) continue;
    odds.locked = true;
    odds.lockedAt = new Date().toISOString();
    odds.statusAtLock = getStatusShort(fixture);
    locked++;
  }

  if (locked) console.log(`Locked pre-match odds for started fixtures: ${locked}`);
  return locked;
}

async function main() {
  const fixturesJson = readJsonIfExists(fixturesPath, null);
  const fixtures = fixturesJson?.response ?? [];
  if (!fixtures.length) {
    console.warn(`No fixtures found at ${fixturesPath}; odds update skipped.`);
    process.exit(0);
  }

  const existing = readJsonIfExists(oddsPath, {
    league: {
      id: LEAGUE,
      name: season.leagueName,
      season: SEASON,
    },
    updated: null,
    fixtures: {},
  });

  existing.league = {
    id: LEAGUE,
    name: season.leagueName,
    season: SEASON,
  };
  existing.fixtures = existing.fixtures ?? {};

  const locked = lockStartedFixtures(existing, fixtures);

  const candidates = fixtures.filter((fixture) => shouldFetchOddsForFixture(fixture, existing));
  console.log(`Odds fetch candidates: ${candidates.length}`);

  let updated = 0;

  for (const fixture of candidates) {
    const fixtureId = getFixtureId(fixture);
    const label = `${fixture?.teams?.home?.name ?? "Home"} vs ${fixture?.teams?.away?.name ?? "Away"}`;

    try {
      const apiJson = await fetchOddsForFixture(fixtureId);
      const normalized = normalizeOddsResponse(apiJson, fixture);

      if (!normalized) {
        console.log(`No usable Match Winner odds for ${fixtureId}: ${label}`);
      } else {
        existing.fixtures[fixtureId] = normalized;
        updated++;
        console.log(
          `Odds ${fixtureId}: ${label} -> ${normalized.consensus.home}% / ${normalized.consensus.draw}% / ${normalized.consensus.away}% from ${normalized.sourceCount} bookmakers`
        );
      }
    } catch (err) {
      console.warn(`Failed to fetch odds for ${fixtureId}; keeping existing value. ${String(err?.message || err)}`);
    }

    await sleep(200);
  }

  if (!updated && !locked && fs.existsSync(oddsPath)) {
    console.log(`Done. No odds entries changed. Total cached: ${Object.keys(existing.fixtures).length}.`);
    return;
  }

  existing.updated = new Date().toISOString();
  writeJson(oddsPath, existing);
  console.log(`Done. Updated odds entries: ${updated}. Total cached: ${Object.keys(existing.fixtures).length}.`);
}

main().catch((err) => {
  console.error("Script error:", err);
  process.exit(1);
});
