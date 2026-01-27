import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import teams from "../data/leagues/epl/2025/teams.json" with { type: "json" };
import { renderMatchweekHTML } from "../lib/prerender/render.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// repo root (src/scripts -> src -> root)
const ROOT = path.join(__dirname, "../..");

const DIST_INDEX = path.join(ROOT, "dist", "index.html");
const MATCHDAYS_DIR = path.join(
  ROOT,
  "public",
  "data",
  "leagues",
  "epl",
  "2025",
  "matchdays"
);

function escapeAttr(s) {
  return String(s ?? "").replace(/"/g, "&quot;");
}

function setTitle(html, title) {
  if (html.includes("<title>")) {
    return html.replace(/<title>.*?<\/title>/s, `<title>${title}</title>`);
  }
  return html.replace("</head>", `  <title>${title}</title>\n</head>`);
}

function setDescription(html, desc) {
  const safe = escapeAttr(desc);
  if (html.match(/<meta\s+name="description"\s+content=".*?"\s*\/?>/i)) {
    return html.replace(
      /<meta\s+name="description"\s+content=".*?"\s*\/?>/i,
      `<meta name="description" content="${safe}" />`
    );
  }
  return html.replace("</head>", `  <meta name="description" content="${safe}" />\n</head>`);
}

function setCanonical(html, canonicalUrl) {
  const safe = escapeAttr(canonicalUrl);
  if (html.match(/<link\s+rel="canonical"\s+href=".*?"\s*\/?>/i)) {
    return html.replace(
      /<link\s+rel="canonical"\s+href=".*?"\s*\/?>/i,
      `<link rel="canonical" href="${safe}" />`
    );
  }
  return html.replace("</head>", `  <link rel="canonical" href="${safe}" />\n</head>`);
}

function injectApp(html, appHtml) {
  // Prefer exact placeholder from your index.html
  if (html.includes('<div id="app"></div>')) {
    return html.replace('<div id="app"></div>', `<div id="app">${appHtml}</div>`);
  }
  // fallback if index.html changes
  return html.replace(/<div\s+id="app"\s*>\s*<\/div>/, `<div id="app">${appHtml}</div>`);
}

async function listMatchdayRounds() {
  const files = await fs.readdir(MATCHDAYS_DIR);
  return files
    .filter((f) => f.endsWith(".json"))
    .map((f) => Number(path.basename(f, ".json")))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
}

async function main() {
  const template = await fs.readFile(DIST_INDEX, "utf8");

  const rounds = await listMatchdayRounds();
  if (!rounds.length) {
    console.log("No matchday JSON files found to prerender.");
    return;
  }

  for (const round of rounds) {
    const mdPath = path.join(MATCHDAYS_DIR, `${round}.json`);
    const md = JSON.parse(await fs.readFile(mdPath, "utf8"));

    const appHtml = renderMatchweekHTML({
      matches: md.matches || [],
      teams,
      globalMode: "compact",
    });

    const pagePath = `/epl/2025/matchweek/${round}/`;

    // NOTE: We'll swap this to your live domain in the SEO step.
    const canonical = `https://timelinefootball.com${pagePath}`;

    let out = template;
    out = setTitle(out, `EPL 2025–26 Matchweek ${round} Timelines | Timeline Football`);
    out = setDescription(
      out,
      `EnglishPremier League 2025–26 Matchweek ${round} results with goals, cards, VAR and substitution timelines.`
    );
    out = setCanonical(out, canonical);
    out = injectApp(out, appHtml);

    const outDir = path.join(ROOT, "dist", "epl", "2025", "matchweek", String(round));
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(path.join(outDir, "index.html"), out, "utf8");

    console.log(`Prerendered ${pagePath}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});