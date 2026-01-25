import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// --- CONFIG: put your real API-Football key + fixture id here ---
const API_KEY = process.env.APIFOOTBALL_KEY;     // <- paste it here temporarily
const FIXTURE_ID = 1035043;                     // <- replace with an actual EPL fixture id
const LEAGUE = 39;                       // <- replace with actual league id if needed
const SEASON = 2025;                   // <- replace with actual season if needed

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

  // If non-2xx, show the body so we see the error from API-Football
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

// https://v3.football.api-sports.io/fixtures?league=39&season=2025

async function main() {
  const fixturesUrl = `https://v3.football.api-sports.io/fixtures?league=${LEAGUE}&season=${SEASON}`;

  const data = await fetchJson(fixturesUrl);

  writeJson("/public/data/dev/fixtures.raw.json", data);


  console.log("Done.");
}

main().catch((err) => {
  console.error("Script error:", err);
  process.exit(1);
});
