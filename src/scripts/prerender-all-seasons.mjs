import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PRERENDER_SEASON_PATHS } from "../config/seasons.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "../..");

for (const seasonPath of PRERENDER_SEASON_PATHS) {
  console.log(`Prerendering ${seasonPath}...`);

  const result = spawnSync(
    process.execPath,
    ["src/scripts/prerender-matchweeks.mjs"],
    {
      cwd: ROOT,
      env: { ...process.env, TIMELINE_SEASON: seasonPath },
      stdio: "inherit",
    }
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
