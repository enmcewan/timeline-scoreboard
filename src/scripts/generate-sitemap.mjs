import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getSeasonConfig, PRERENDER_SEASON_PATHS, ACTIVE_SEASON_PATH } from "../config/seasons.js";
import { pickInitialRound } from "./get-current-round.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "../..");

const DIST_DIR = path.join(ROOT, "dist");

// Change later if you decide on www, but this is fine for now:
const SITE_ORIGIN = "https://timelinefootball.com";

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function listMatchweekPages(season) {
  const base = path.join(DIST_DIR, "epl", season.seasonPath, "matchweek");
  let rounds = [];
  try {
    const entries = await fs.readdir(base, { withFileTypes: true });
    rounds = entries
      .filter((e) => e.isDirectory())
      .map((e) => Number(e.name))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
  } catch {
    // no prerendered pages yet
  }
  return rounds;
}

async function readJsonIfExists(filePath, fallback) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (err) {
    if (err?.code === "ENOENT") return fallback;
    throw err;
  }
}

async function getCurrentRoundForSeason(season) {
  const base = path.join(
    ROOT,
    "public",
    "data",
    "leagues",
    season.leagueKey,
    season.seasonPath,
    "matchweeks"
  );
  const files = await fs.readdir(base).catch(() => []);
  const matchdays = {};

  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const round = Number(path.basename(f, ".json"));
    if (!Number.isFinite(round)) continue;
    matchdays[String(round)] = await readJsonIfExists(path.join(base, f), null);
  }

  return pickInitialRound(matchdays);
}

function getMatchweekChangefreq(round, currentRound) {
  if (!currentRound) return "daily";

  if (round === currentRound || round === currentRound - 1) {
    return "daily";
  }

  if (round > currentRound) {
    return "daily";
  }

  return "never";
}

function isoDateOnly(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

async function getPageLastmod(relativePath) {
  const filePath = path.join(DIST_DIR, relativePath, "index.html");

  try {
    const stat = await fs.stat(filePath);
    return new Date(stat.mtimeMs).toISOString();
  } catch {
    return isoDateOnly();
  }
}

async function main() {
  const urls = [];

  // homepage points to the active season.
  urls.push({ loc: `${SITE_ORIGIN}/`, changefreq: "hourly", priority: "1.0", lastmod: await getPageLastmod(".") });

  for (const seasonPath of PRERENDER_SEASON_PATHS) {
    const season = getSeasonConfig(seasonPath);
    const teamsPath = path.join(
      ROOT,
      "src",
      "data",
      "leagues",
      season.leagueKey,
      season.sourceDataSeason,
      "teams.json"
    );
    const teams = await readJsonIfExists(teamsPath, {});
    const rounds = await listMatchweekPages(season);
    const currentRound = await getCurrentRoundForSeason(season);
    const isActive = season.seasonPath === ACTIVE_SEASON_PATH;
    const liveChangefreq = isActive ? "daily" : "never";

    urls.push({
      loc: `${SITE_ORIGIN}/epl/${season.seasonPath}/`,
      changefreq: isActive ? "monthly" : "never",
      priority: isActive ? "0.8" : "0.4",
      lastmod: await getPageLastmod(`epl/${season.seasonPath}`),
    });

    urls.push({
      loc: `${SITE_ORIGIN}/epl/${season.seasonPath}/table/`,
      changefreq: liveChangefreq,
      priority: isActive ? "0.8" : "0.4",
      lastmod: await getPageLastmod(`epl/${season.seasonPath}/table`),
    });

    for (const slug of Object.keys(teams)) {
      urls.push({
        loc: `${SITE_ORIGIN}/epl/${season.seasonPath}/team/${slug}/`,
        changefreq: liveChangefreq,
        priority: isActive ? "0.7" : "0.4",
        lastmod: await getPageLastmod(`epl/${season.seasonPath}/team/${slug}`),
      });
    }

    for (const r of rounds) {
      urls.push({
        loc: `${SITE_ORIGIN}/epl/${season.seasonPath}/matchweek/${r}/`,
        changefreq: isActive ? getMatchweekChangefreq(r, currentRound) : "never",
        priority: isActive && r === currentRound ? "0.9" : isActive ? "0.7" : "0.4",
        lastmod: await getPageLastmod(`epl/${season.seasonPath}/matchweek/${r}`),
      });
    }
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    ${urls
          .map(
            (u) => `  <url>
        <loc>${xmlEscape(u.loc)}</loc>
    ${u.lastmod ? `    <lastmod>${xmlEscape(u.lastmod)}</lastmod>` : ""}
        <changefreq>${u.changefreq}</changefreq>
        <priority>${u.priority}</priority>
      </url>`
          )
      .join("\n")}
    </urlset>
    `;

  const outPath = path.join(DIST_DIR, "sitemap.xml");
  await fs.writeFile(outPath, xml, "utf8");
  console.log(`Wrote ${outPath} (${urls.length} urls)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
