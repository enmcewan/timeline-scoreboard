import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "../..");

const SEASON = "2025-26";
const LEAGUE = "epl";
const MATCHWEEKS_DIR = path.join(
  ROOT,
  "public",
  "data",
  "leagues",
  LEAGUE,
  SEASON,
  "matchweeks"
);

const GRACE_MS = 6 * 60 * 60 * 1000;

export function pickInitialRound(matchdays, nowMs = Date.now()) {
  const rounds = Object.entries(matchdays)
    .map(([roundStr, md]) => {
      const round = Number(roundStr);
      const times = (md.matches || [])
        .map((m) => Date.parse(m.kickoff))
        .filter(Number.isFinite);

      if (!times.length) return null;

      return {
        round,
        minKickoff: Math.min(...times),
        maxKickoff: Math.max(...times),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.minKickoff - b.minKickoff);

  if (!rounds.length) return null;

  const current = rounds.find(
    (r) => nowMs >= r.minKickoff - GRACE_MS && nowMs <= r.maxKickoff + GRACE_MS
  );
  if (current) return current.round;

  const next = rounds.find((r) => r.minKickoff > nowMs);
  if (next) return next.round;

  return rounds[rounds.length - 1].round;
}

export async function getCurrentRound() {
  const files = await fs.readdir(MATCHWEEKS_DIR).catch(() => []);
  const matchdays = {};

  for (const f of files) {
    if (!f.endsWith(".json")) continue;

    const round = Number(path.basename(f, ".json"));
    if (!Number.isFinite(round)) continue;

    const mdPath = path.join(MATCHWEEKS_DIR, f);
    const md = JSON.parse(await fs.readFile(mdPath, "utf8"));
    matchdays[String(round)] = md;
  }

  return pickInitialRound(matchdays);
}

async function main() {
  const round = await getCurrentRound();

  if (!round) {
    console.error("Could not determine current round.");
    process.exit(1);
  }

  console.log(`round=${round}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}