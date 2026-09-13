import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "../..");

const season = process.env.TIMELINE_SEASON || "2026-27";

const steps = [
  ["Fetch fixtures", "src/scripts/fetch-fixtures.mjs"],
  ["Fetch events", "src/scripts/fetch-events.byFixture.mjs"],
  ["Refresh matchweeks", "src/scripts/refresh-epl-season.mjs"],
  ["Publish live data", "src/scripts/publish-live-data.mjs"],
];

function runStep([label, script]) {
  return new Promise((resolve, reject) => {
    console.log(`\n=== ${label} ===`);

    const child = spawn(process.execPath, [script], {
      cwd: ROOT,
      env: {
        ...process.env,
        TIMELINE_SEASON: season,
      },
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label} failed with exit code ${code}`));
    });
  });
}

async function main() {
  if (!process.env.APIFOOTBALL_KEY) {
    throw new Error("Missing APIFOOTBALL_KEY env var.");
  }

  for (const step of steps) {
    await runStep(step);
  }

  console.log("\nLive update complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
