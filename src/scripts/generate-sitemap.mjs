import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import teams from "../data/leagues/epl/2025/teams.json" with { type: "json" };
import { getCurrentRound } from "./get-current-round.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "../..");

const DIST_DIR = path.join(ROOT, "dist");

// Change later if you decide on www, but this is fine for now:
const SITE_ORIGIN = "https://timelinefootball.com";
const MATCH_HUB = "https://timelinefootball.com/epl/2025-26/";

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function listMatchweekPages() {
  const base = path.join(DIST_DIR, "epl", "2025-26", "matchweek");
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

  const rounds = await listMatchweekPages();
  const currentRound = await getCurrentRound();

  const urls = [];

  // homepage
  urls.push({ loc: `${SITE_ORIGIN}/`, changefreq: "hourly", priority: "1.0", lastmod: await getPageLastmod(".") });

  // match hub
  urls.push({
    loc: MATCH_HUB,
    changefreq: "monthly",
    priority: "0.8",
  });

  // table
  urls.push({
    loc: `${SITE_ORIGIN}/epl/2025-26/table/`,
    changefreq: "daily",
    priority: "0.8",
    lastmod: await getPageLastmod("epl/2025-26/table"),
  });

  // teams
  for (const slug of Object.keys(teams)) {
    urls.push({
      loc: `${SITE_ORIGIN}/epl/2025-26/team/${slug}/`,
      changefreq: "daily",
      priority: "0.7",
      lastmod: await getPageLastmod(`epl/2025-26/team/${slug}`),
    });
  }
  // matchweeks
  for (const r of rounds) {
    urls.push({
      loc: `${SITE_ORIGIN}/epl/2025-26/matchweek/${r}/`,
      changefreq: getMatchweekChangefreq(r, currentRound),
      priority: r === currentRound ? "0.9" : "0.7",
      lastmod: await getPageLastmod(`epl/2025-26/matchweek/${r}`),
    });
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
