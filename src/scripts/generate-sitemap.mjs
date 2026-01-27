import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

async function listMatchweekPages() {
  const base = path.join(DIST_DIR, "epl", "2025", "matchweek");
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

async function main() {
  const rounds = await listMatchweekPages();

  const urls = [];

  // homepage
  urls.push({ loc: `${SITE_ORIGIN}/`, changefreq: "hourly", priority: "1.0" });

  // matchweeks
  for (const r of rounds) {
    urls.push({
      loc: `${SITE_ORIGIN}/epl/2025/matchweek/${r}/`,
      changefreq: "hourly",
      priority: "0.8",
    });
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) => `  <url>
    <loc>${xmlEscape(u.loc)}</loc>
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
