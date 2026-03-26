import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API_KEY = process.env.APIFOOTBALL_KEY;
const LEAGUE = 39;
const SEASON = 2025;
const DATAPATH = "/public/data/leagues/epl/2025-26/";

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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isTransientApiError(err) {
  const msg = String(err?.message || err);
  return (
    msg.includes("503") ||
    msg.includes("502") ||
    msg.includes("504") ||
    msg.includes("429") ||
    msg.toLowerCase().includes("timeout") ||
    msg.toLowerCase().includes("econnreset") ||
    msg.toLowerCase().includes("socket hang up")
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
      console.warn(
        `Transient API error (attempt ${attempt}/${tries}): ${String(err?.message || err)}`
      );
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

  let json;
  try {
    json = JSON.parse(body);
  } catch (e) {
    console.error("Failed to parse JSON body:\n", body);
    throw e;
  }

  validateApiPayload(json);
  return json;
}

async function main() {
  const fixturesUrl = `https://v3.football.api-sports.io/fixtures?league=${LEAGUE}&season=${SEASON}`;

  const data = await fetchWithRetry(
    () => fetchJson(fixturesUrl),
    { tries: 5, baseDelayMs: 750 }
  );

  writeJson(`${DATAPATH}fixtures.raw.json`, data);

  console.log("Done.");
}

main().catch((err) => {
  console.error("Script error:", err);
  process.exit(1);
});