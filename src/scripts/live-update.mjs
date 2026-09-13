import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "../..");
const LOCK_PATH = path.join(ROOT, ".live-update.lock");
const STALE_LOCK_MS = 45 * 60 * 1000;

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
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      if (signal) {
        reject(new Error(`${label} was killed by signal ${signal}`));
        return;
      }
      reject(new Error(`${label} failed with exit code ${code}`));
    });
  });
}

async function acquireLock() {
  try {
    const existing = JSON.parse(await fs.readFile(LOCK_PATH, "utf8"));
    const ageMs = Date.now() - Date.parse(existing.startedAt || "");

    if (Number.isFinite(ageMs) && ageMs < STALE_LOCK_MS) {
      console.log(
        `Another live update appears to be running. Lock age: ${Math.round(ageMs / 1000)}s. Skipping.`
      );
      process.exit(0);
    }

    console.warn("Removing stale live-update lock.");
    await fs.rm(LOCK_PATH, { force: true });
  } catch (err) {
    if (err?.code !== "ENOENT" && err instanceof SyntaxError === false) {
      throw err;
    }
    if (err instanceof SyntaxError) {
      console.warn("Removing unreadable live-update lock.");
      await fs.rm(LOCK_PATH, { force: true });
    }
  }

  let handle;
  try {
    handle = await fs.open(LOCK_PATH, "wx");
  } catch (err) {
    if (err?.code === "EEXIST") {
      console.log("Another live update acquired the lock first. Skipping.");
      process.exit(0);
    }
    throw err;
  }

  await handle.writeFile(
    JSON.stringify(
      {
        pid: process.pid,
        startedAt: new Date().toISOString(),
        season,
      },
      null,
      2
    )
  );
  await handle.close();
}

async function releaseLock() {
  await fs.rm(LOCK_PATH, { force: true });
}

async function main() {
  if (!process.env.APIFOOTBALL_KEY) {
    throw new Error("Missing APIFOOTBALL_KEY env var.");
  }

  await acquireLock();

  try {
    for (const step of steps) {
      await runStep(step);
    }
  } finally {
    await releaseLock();
  }

  console.log("\nLive update complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
