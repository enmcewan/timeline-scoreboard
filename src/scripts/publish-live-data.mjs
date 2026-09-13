import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getSeasonConfigFromEnv } from "../config/seasons.js";
import { getCurrentRound } from "./get-current-round.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "../..");

const season = getSeasonConfigFromEnv();
const sourceDir = path.join(
  ROOT,
  "public",
  "data",
  "leagues",
  season.leagueKey,
  season.seasonPath
);

const outRoot = path.resolve(
  process.env.LIVE_DATA_OUT_DIR || path.join(ROOT, "live-data")
);
const outSeasonDir = path.join(outRoot, season.leagueKey, season.seasonPath);
const outMatchweeksDir = path.join(outSeasonDir, "matchweeks");

async function readJson(filePath, fallback = null) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    return fallback;
  }
}

async function copyIfExists(fileName) {
  const sourcePath = path.join(sourceDir, fileName);
  const outPath = path.join(outSeasonDir, fileName);

  try {
    await fs.copyFile(sourcePath, outPath);
    return true;
  } catch (err) {
    if (err?.code === "ENOENT") return false;
    throw err;
  }
}

async function copyMatchweeks() {
  await fs.mkdir(outMatchweeksDir, { recursive: true });

  const sourceMatchweeksDir = path.join(sourceDir, "matchweeks");
  const files = await fs.readdir(sourceMatchweeksDir).catch(() => []);
  const copied = [];

  for (const file of files) {
    if (!/^\d+\.json$/.test(file)) continue;
    await fs.copyFile(
      path.join(sourceMatchweeksDir, file),
      path.join(outMatchweeksDir, file)
    );
    copied.push(Number(path.basename(file, ".json")));
  }

  copied.sort((a, b) => a - b);
  return copied;
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function writeApacheHeaders() {
  const htaccess = [
    "<IfModule mod_headers.c>",
    '  Header set Access-Control-Allow-Origin "https://timelinefootball.com"',
    '  Header set Access-Control-Allow-Methods "GET, OPTIONS"',
    '  Header set Access-Control-Allow-Headers "Content-Type"',
    '  Header set Cache-Control "public, max-age=60"',
    "</IfModule>",
    "",
    "<IfModule mod_mime.c>",
    "  AddType application/json .json",
    "</IfModule>",
    "",
  ].join("\n");

  await fs.writeFile(path.join(outRoot, ".htaccess"), htaccess, "utf8");
}

async function main() {
  await fs.mkdir(outSeasonDir, { recursive: true });

  const copiedMatchweeks = await copyMatchweeks();

  const copiedFiles = [];
  for (const fileName of [
    "fixtures.raw.json",
    "events.raw.json",
    "standings.json",
    "odds.json",
    "players.json",
    "season-context.json",
  ]) {
    if (await copyIfExists(fileName)) copiedFiles.push(fileName);
  }

  const currentRound = await getCurrentRound();
  const currentMatchweekPath =
    currentRound == null
      ? null
      : path.join(outMatchweeksDir, `${currentRound}.json`);
  const currentMatchweek = currentMatchweekPath
    ? await readJson(currentMatchweekPath)
    : null;

  const publishedAt = new Date().toISOString();

  if (currentMatchweek) {
    await writeJson(path.join(outMatchweeksDir, "current.json"), {
      ...currentMatchweek,
      publishedAt,
      source: "lauris-webdev-live-data",
      seasonPath: season.seasonPath,
    });
  }

  await writeJson(path.join(outSeasonDir, "health.json"), {
    ok: true,
    publishedAt,
    source: "lauris-webdev-live-data",
    leagueKey: season.leagueKey,
    seasonPath: season.seasonPath,
    currentRound,
    copiedFiles,
    copiedMatchweeks,
  });

  await writeApacheHeaders();

  console.log(`Published live data to: ${outRoot}`);
  console.log(`Season data: ${outSeasonDir}`);
  console.log(`Current round: ${currentRound ?? "unknown"}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
