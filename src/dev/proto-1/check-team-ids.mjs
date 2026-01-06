import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEAMS_PATH = path.join(__dirname, "../data/leagues/epl/teams.json");
const MATCHDAYS_DIR = path.join(__dirname, "../data/leagues/epl/2025/matchdays");

async function main() {
  const teamsJson = JSON.parse(await fs.readFile(TEAMS_PATH, "utf8"));
  const definedKeys = new Set(Object.keys(teamsJson));

  const files = await fs.readdir(MATCHDAYS_DIR);
  const missing = new Set();

  for (const fname of files) {
    if (!fname.endsWith(".json")) continue;

    const fullPath = path.join(MATCHDAYS_DIR, fname);
    const mdJson = JSON.parse(await fs.readFile(fullPath, "utf8"));

    const matches = mdJson.matches ?? [];
    for (const m of matches) {
      if (!definedKeys.has(m.homeTeamId)) {
        missing.add(m.homeTeamId);
      }
      if (!definedKeys.has(m.awayTeamId)) {
        missing.add(m.awayTeamId);
      }
    }
  }

  console.log("Team IDs used in matchdays but missing from teams.json:");
  console.log([...missing].sort());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
