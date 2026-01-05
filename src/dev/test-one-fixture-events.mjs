import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_KEY = "REMOVED";
const BASE_URL = "https://v3.football.api-sports.io";

// pick any one of those IDs you saw in the log
const FIXTURE_ID = 1378969;

async function main() {
  if (!API_KEY) {
    console.error("Missing APIFOOTBALL_KEY env var");
    process.exit(1);
  }

  const url = `${BASE_URL}/fixtures/events?fixture=${FIXTURE_ID}`;

  console.log("GET", url);

  const res = await fetch(url, {
    headers: {
      "x-apisports-key": API_KEY
    }
  });

  console.log("HTTP status:", res.status, res.statusText);

  const json = await res.json();

  console.log("API get:", json.get);
  console.log("parameters:", json.parameters);
  console.log("errors:", json.errors);
  console.log("results:", json.results);

  if (json.response && json.response.length) {
    console.log("First event:", json.response[0]);
  } else {
    console.log("No events in response");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
