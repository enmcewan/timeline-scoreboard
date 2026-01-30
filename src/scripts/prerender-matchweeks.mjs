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

function setJsonLd(html, jsonLdObject) {
    const json = JSON.stringify(jsonLdObject);
    // if already present, replace first ld+json block
    if (html.match(/<script\s+type="application\/ld\+json">[\s\S]*?<\/script>/i)) {
        return html.replace(
            /<script\s+type="application\/ld\+json">[\s\S]*?<\/script>/i,
            `<script type="application/ld+json">${json}</script>`
        );
    }
    return html.replace(
        "</head>",
        `  <script type="application/ld+json">${json}</script>\n</head>`
    );
}

function teamToJsonLd(team) {
    const out = { "@type": "SportsTeam", name: team.name };
    if (Array.isArray(team.altNames) && team.altNames.length) {

        const filtered = team.altNames.filter(
            n => n.toLowerCase() !== team.name.toLowerCase()
        );

        if (filtered.length) out.alternateName = filtered;
    }
    return out;
}

function statusToEventStatus(state) {
    const st = String(state || "").toUpperCase();
    if (st === "FT") return "https://schema.org/EventCompleted";
    if (st === "NS") return "https://schema.org/EventScheduled";
    if (st === "HT") return "https://schema.org/EventInProgress";
    if (st.includes("'")) return "https://schema.org/EventInProgress";
    return undefined; // omit for weird/unknown states
}

function matchToSportsEventLd(match, teamsById, pageUrl) {

    const home = teamsById[match.homeTeamId];
    const away = teamsById[match.awayTeamId];

    const homeName = home?.name ?? String(match.homeTeamId);
    const awayName = away?.name ?? String(match.awayTeamId);

    const evt = {
        "@type": "SportsEvent",
        name: `${homeName} vs ${awayName}`,
        startDate: match.kickoff,
        sport: "https://schema.org/Soccer",
        url: `${pageUrl}#fixture-${match.id}`,
    };

    if (home && away) {
        evt.homeTeam = teamToJsonLd(home);
        evt.awayTeam = teamToJsonLd(away);
        evt.competitor = [teamToJsonLd(home), teamToJsonLd(away)];
    }

    if (match.venue) evt.location = { "@type": "Place", name: match.venue };

    const es = statusToEventStatus(match.status?.state);
    if (es) evt.eventStatus = es;

    // Optional: include final score only when FT
    if (String(match.status?.state || "").toUpperCase() === "FT") {
        evt.homeScore = match.score?.home;
        evt.awayScore = match.score?.away;
    }

    return evt;
}

function matchweekJsonLd({ seasonLabel, round, matches, teamsById, pageUrl }) {

    const list = Array.isArray(matches) ? matches : [];

    return {
        "@context": "https://schema.org",
        "@type": "ItemList",
        name: `English Premier League ${seasonLabel} Matchweek ${round} results and timelines`,
        itemListOrder: "https://schema.org/ItemListOrderAscending",
        numberOfItems: list.length,
        itemListElement: list.map((m, i) => ({
            "@type": "ListItem",
            position: i + 1,
            item: matchToSportsEventLd(m, teamsById, pageUrl)
        }))
    };
}

function getMatchweekStartKickoffISO(md) {
    const times = (md?.matches || [])
        .map((m) => Date.parse(m.kickoff))
        .filter(Number.isFinite);

    if (!times.length) return null;

    const minMs = Math.min(...times);
    return new Date(minMs).toISOString();
}

async function buildMatchweekStartDateMap(rounds) {
    // returns: { [roundNumber]: "Aug 15, 2025" }
    const fmt = new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "2-digit",
        year: "numeric",
    });

    const out = {};

    for (const round of rounds) {
        const mdPath = path.join(MATCHDAYS_DIR, `${round}.json`);
        const md = JSON.parse(await fs.readFile(mdPath, "utf8"));

        const iso = getMatchweekStartKickoffISO(md);
        if (!iso) continue;

        out[round] = fmt.format(new Date(iso));
    }

    return out
}

function buildSeasonHubHtml({ seasonStart, seasonLabel, maxRound, matchweekStartDates }) {
    const cards = Array.from({ length: maxRound }, (_, i) => {
        const round = i + 1;
        const displayRound = round.toString().padStart(2, "0");

        const startDate = matchweekStartDates?.[round] ?? ""; // fallback if missing
        const dateLine = startDate ? `${startDate}` : `EPL ${seasonLabel}`;

        return `
      <a href="/epl/${seasonStart}/matchweek/${round}/" class="mw-card">
        <div class="mw-number">${displayRound}</div>
        <div class="mw-label">Matchweek</div>
        <div class="mw-divider"></div>
        <div class="mw-date">${dateLine}</div>
      </a>
    `;
    }).join("\n");

    return `
    <section class="season-hub">
      <h2>Matchweeks ${seasonLabel}</h2>
      <p>
        Browse match timelines by matchweek for the EPL ${seasonLabel} season.
        Each matchweek page includes goals, cards, VAR decisions, and substitutions in chronological order.
      </p>

      <nav aria-label="Matchweeks">
        <div class="matchweek-grid">
          ${cards}
        </div>
      </nav>
    </section>
  `.trim();
}


function stripAppScripts(html) {
    // Remove any module scripts (Vite-built bundle or dev script tag)
    return html
        .replace(/<script\b[^>]*type=["']module["'][^>]*>[\s\S]*?<\/script>\s*/gi, "")
        .replace(/<script\b[^>]*type=["']module["'][^>]*\/>\s*/gi, "");
}

function stripMatchdayShell(html) {
    // Removes the whole <div class="matchday-shell"> ... </div> block
    // Non-greedy match; assumes your template has a single matchday-shell.
    return html.replace(
        /<div\s+class="matchday-shell">[\s\S]*?<\/div>\s*<\/div>\s*/i,
        ""
    );
}

async function listMatchdayRounds() {
    const files = await fs.readdir(MATCHDAYS_DIR);
    return files
        .filter((f) => f.endsWith(".json"))
        .map((f) => Number(path.basename(f, ".json")))
        .filter(Number.isFinite)
        .sort((a, b) => a - b);
}

function buildMatchweekPrevNextNav({ seasonStart, seasonLabel, round, maxRound }) {
    const prev = round > 1 ? `/epl/${seasonStart}/matchweek/${round - 1}/` : null;
    const next = round < maxRound ? `/epl/${seasonStart}/matchweek/${round + 1}/` : null;
    const hub = `/epl/${seasonStart}/`;

    return `
    <nav class="mw-nav" aria-label="Matchweek navigation">
      <a id="mw-hub" class="mw-nav__hub" href="${hub}">EPL ${seasonLabel} matchweeks</a>
      <div class="mw-nav__pager">
        ${prev ? `<a id="mw-prev" class="mw-nav__prev" href="${prev}" rel="prev">← Matchweek ${round - 1}</a>` : `<span class="mw-nav__prev is-disabled" aria-disabled="true">← Matchweek ${round - 1}</span>`}
        ${next ? `<a id="mw-next" class="mw-nav__next" href="${next}" rel="next">Matchweek ${round + 1} →</a>` : `<span class="mw-nav__next is-disabled" aria-disabled="true">Matchweek ${round + 1} →</span>`}
      </div>
    </nav>
  `.trim();
}

function injectBeforeApp(html, extraHtml) {
    return html.replace('<div class="nav-container"></div>', `<div class="nav-container">${extraHtml}</div>`);
}

async function main() {

    const template = await fs.readFile(DIST_INDEX, "utf8");

    const seasonStart = 2025;
    const seasonLabel = "2025–26";
    const maxRound = 38;

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
            `English Premier League 2025–26 Matchweek ${round} results with goals, cards, VAR and substitution timelines.`
        );
        out = setCanonical(out, canonical);

        // ---- JSON-LD (matchweek page) ----
        const ld = matchweekJsonLd({
            season: 2025,
            seasonLabel: "2025–26",
            round,
            matches: md.matches || [],
            teamsById: teams,
            pageUrl: canonical
        });
        out = setJsonLd(out, ld);
        // ---------------------------------

        const navHtml = buildMatchweekPrevNextNav({
            seasonStart,
            seasonLabel,
            round,
            maxRound
        });

        out = injectBeforeApp(out, navHtml);

        out = injectApp(out, appHtml);

        const outDir = path.join(ROOT, "dist", "epl", "2025", "matchweek", String(round));
        await fs.mkdir(outDir, { recursive: true });
        await fs.writeFile(path.join(outDir, "index.html"), out, "utf8");

        console.log(`Prerendered ${pagePath}`);
    }

    const hubPath = `/epl/${seasonStart}/`;
    const canonical = `https://timelinefootball.com${hubPath}`;

    let out = template;

    out = setTitle(out, `EPL ${seasonLabel} Matchweeks 1–${maxRound} | Timeline Football`);
    out = setDescription(
        out,
        `Browse English Premier League ${seasonLabel} match timelines by matchweek (1–${maxRound}).`
    );

    out = setCanonical(out, canonical);

    const matchweekStartDates = await buildMatchweekStartDateMap(rounds);

    const hubHtml = buildSeasonHubHtml({
        seasonStart,
        seasonLabel,
        maxRound,
        matchweekStartDates
    });

    out = injectApp(out, hubHtml);

    // write it
    const seasonOutDir = path.join(ROOT, "dist", "epl", "2025");
    await fs.mkdir(seasonOutDir, { recursive: true });

    const hubOutFile = path.join(seasonOutDir, "index.html");

    // IMPORTANT: hub should not boot the SPA
    out = stripAppScripts(out);

    // hub should not show matchweek dropdown/button
    out = stripMatchdayShell(out);
    await fs.writeFile(hubOutFile, out, "utf8");

    console.log("Prerendered /epl/2025/");

}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});