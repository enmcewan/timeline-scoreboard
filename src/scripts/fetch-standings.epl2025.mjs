import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API_KEY = process.env.APIFOOTBALL_KEY;
const LEAGUE = 39;
const SEASON = 2025;

if (!API_KEY) {
  console.error("Missing APIFOOTBALL_KEY env var (APIFOOTBALL_KEY)");
  process.exit(1);
}

// --- resolve project root paths ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");

function writeJson(relativePath, data) {
  const full = path.join(projectRoot, relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(data, null, 2), "utf8");
  console.log(`Wrote: ${full}`);
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

  try {
    return JSON.parse(body);
  } catch (e) {
    console.error("Failed to parse JSON body:\n", body);
    throw e;
  }
}

function normalizeStandings(apiJson) {
  const league = apiJson?.response?.[0]?.league;
  const table = league?.standings?.[0]; // first group in standings matrix

  if (!league || !Array.isArray(table)) {
    throw new Error("Unexpected standings response shape (missing league/standings).");
  }

  const updated =
    table.find((r) => r?.update)?.update ??
    null;

  return {
    league: {
      id: league.id,
      name: league.name,
      country: league.country,
      season: league.season,
      updated,
    },
    table: table.map((r) => ({
      rank: r.rank,
      teamApiId: r.team?.id ?? null,
      teamName: r.team?.name ?? "",
      points: r.points ?? 0,
      gd: r.goalsDiff ?? 0,
      form: r.form ?? "",
      status: r.status ?? "",
      description: r.description ?? null,
      all: {
        p: r.all?.played ?? 0,
        w: r.all?.win ?? 0,
        d: r.all?.draw ?? 0,
        l: r.all?.lose ?? 0,
        gf: r.all?.goals?.for ?? 0,
        ga: r.all?.goals?.against ?? 0,
      },
    })),
  };
}

async function main() {
  const url = `https://v3.football.api-sports.io/standings?league=${LEAGUE}&season=${SEASON}`;

  const apiJson = await fetchJson(url);

  // optional: dev dump for inspection
  // writeJson("/public/data/dev/standings.raw.json", apiJson);

  const normalized = normalizeStandings(apiJson);

  writeJson(`/public/data/leagues/epl/${SEASON}/standings.json`, normalized);

  console.log(
    `Done. Rows: ${normalized.table.length}, Updated: ${normalized.league.updated ?? "n/a"}`
  );
}

main().catch((err) => {
  console.error("Script error:", err);
  process.exit(1);
});