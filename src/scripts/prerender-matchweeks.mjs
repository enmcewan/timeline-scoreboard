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

const STANDINGS_PATH = path.join(
    ROOT,
    "public",
    "data",
    "leagues",
    "epl",
    "2025-26",
    "standings.json"
);

function formatISODate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "2-digit" }).format(d);
}

function buildApiTeamIdToSlugMap(teamsBySlug) {
    const map = new Map();
    for (const [slug, t] of Object.entries(teamsBySlug)) {
        if (map.has(t.apiTeamId)) {
            throw new Error(`Duplicate apiTeamId ${t.apiTeamId} in teams.json (${map.get(t.apiTeamId)} and ${slug})`);
        }
        map.set(t.apiTeamId, slug);
    }
    return map;
}

function getStandingsRows(standingsJson) {
    // adapt to your normalized structure if needed
    if (Array.isArray(standingsJson)) return standingsJson;
    if (Array.isArray(standingsJson.table)) return standingsJson.table;
    if (Array.isArray(standingsJson.rows)) return standingsJson.rows;
    if (Array.isArray(standingsJson.standings)) return standingsJson.standings;
    if (Array.isArray(standingsJson.response)) return standingsJson.response;
    throw new Error("Standings rows array not found in standings.json");
}

function buildLeagueTableHtml({ seasonPath, seasonLabel, rows, teamsBySlug, apiIdToSlug, updatedLabel }) {
    const bodyRows = rows.map((r) => {
        const slug = apiIdToSlug.get(r.teamApiId);
        if (!slug) throw new Error(`Standings teamApiId ${r.teamApiId} not found in teams.json`);
        const team = teamsBySlug[slug];

        const all = r.all || {};
        return `
      <tr>
        <td id="${r.rank ?? ""}">${r.rank ?? ""}</td>
        <td class="text-center">
          <img class="${slug}" src="${team.badge}" alt="${escapeAttr(team.name)} badge" height="28" loading="lazy">
        </td>
        <td class="table-team">
            <strong><a class="tbl-link" href="/epl/${seasonPath}/team/${slug}/">${team.name}</a></strong><span> &#9655;</span>
        </td>
        <td class="text-center">${all.p ?? ""}</td>
        <td class="text-center">${all.w ?? ""}</td>
        <td class="text-center">${all.d ?? ""}</td>
        <td class="text-center">${all.l ?? ""}</td>
        <td class="text-center">${all.gf ?? ""}</td>
        <td class="text-center">${all.ga ?? ""}</td>
        <td class="text-center">${r.gd ?? ""}</td>
        <td class="text-center"><strong>${r.points ?? ""}</strong></td>
        <td class="text-center mono tbl-form">${[...escapeAttr(r.form)].reverse().join("") ?? ""}</td>
      </tr>
    `.trim();
    }).join("\n");

    return `
    <section class="league-table-page">
      <h2 class="text-center">${seasonLabel} Table</h2>
      ${updatedLabel ? `<p class="muted">Last updated: ${updatedLabel}</p>` : ""}
      <div class="table-scroll" role="region" aria-label="League table" tabindex="0">
        <table class="league-table">
            <thead>
            <tr>
                <th scope="col">Pos</th>
                <th scope="col"></th>
                <th scope="col">Team</th>
                <th scope="col">P</th>
                <th scope="col">W</th>
                <th scope="col">D</th>
                <th scope="col">L</th>
                <th scope="col">GF</th>
                <th scope="col">GA</th>
                <th scope="col">GD</th>
                <th scope="col">Pts</th>
                <th scope="col">Form</th>
            </tr>
            </thead>
            <tbody>
            ${bodyRows}
            </tbody>
        </table>
      </div>
    </section>
  `.trim();
}

function buildTeamMatchesIndex({ roundsData, teamsBySlug, seasonPath }) {
    // Map: slug -> matches[]
    const out = {};
    for (const slug of Object.keys(teamsBySlug)) out[slug] = [];

    for (const md of roundsData) {
        const round = md.round;
        for (const m of md.matches || []) {
            const home = m.homeTeamId;
            const away = m.awayTeamId;

            if (!teamsBySlug[home] || !teamsBySlug[away]) {
                throw new Error(`Unknown team slug in matchday ${round}: ${home} vs ${away}`);
            }

            const fixtureId = m.id;
            const kickoff = m.kickoff;
            const state = m.status?.state ?? "";
            const href = `/epl/${seasonPath}/matchweek/${round}/#fixture-${fixtureId}`;

            // home entry
            out[home].push({
                round,
                fixtureId,
                kickoff,
                isHome: true,
                opponentSlug: away,
                opponentName: teamsBySlug[away].name,
                scoreFor: m.score?.home ?? null,
                scoreAgainst: m.score?.away ?? null,
                state,
                href
            });

            // away entry
            out[away].push({
                round,
                fixtureId,
                kickoff,
                isHome: false,
                opponentSlug: home,
                opponentName: teamsBySlug[home].name,
                scoreFor: m.score?.away ?? null,
                scoreAgainst: m.score?.home ?? null,
                state,
                href
            });
        }
    }

    // Sort each list by kickoff
    for (const slug of Object.keys(out)) {
        out[slug].sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff));
    }

    return out;
}

function buildTeamPageHtml({ seasonPath, seasonLabel, slug, team, standingsRow, matches, updatedLabel }) {
    const all = standingsRow?.all || null;

    const summary = standingsRow && all
        ? `${team.name} are ${standingsRow.rank}th in the EPL ${seasonLabel} table with ${standingsRow.points} points from ${all.p} matches (${all.w}W-${all.d}D-${all.l}L) and a goal difference of ${standingsRow.gd >= 0 ? "+" : ""}${standingsRow.gd}.`
        : `${team.name} EPL ${seasonLabel} season page with results and match timelines by matchweek.`;

    const rowsHtml = (matches || []).map((m) => {
        const date = m.kickoff ? formatISODate(m.kickoff) : "";
        const vsAt = m.isHome ? "H &nbsp;" : "A &nbsp;";
        const score = (m.scoreFor != null && m.scoreAgainst != null) ? `${m.scoreFor}–${m.scoreAgainst}` : "–";

        return `
                <tr>
                    <td class="text-center">${date}</td>
                    <td>${vsAt} <strong><a class="tbl-link" href="/epl/${seasonPath}/team/${m.opponentSlug}/">${m.opponentName} &#9655;</a></strong></td>
                    <td class="text-center"><strong>${score}</strong></td>
                    <td class="text-center">${escapeAttr(m.state)}</td>
                    <td class="text-center"><a class="tbl-link" href="${m.href}">Timeline &#9655;</a></td>
                </tr>
            `.trim();
    }).join("\n");

    const v = team.venue;

    const venueHtml = v?.name ? `
        <div class="team-venue">
            ${v.image ? `<img class="team-venue__img" src="${v.image}" alt="${escapeAttr(v.name)}" loading="lazy">` : ""}
            <div class="team-venue__meta">
            <div class="team-venue__name"><strong>${escapeAttr(v.name)}</strong></div>
            <div class="muted">
                ${escapeAttr(v.city || "")}
                ${v.capacity ? ` • Capacity ${Number(v.capacity).toLocaleString("en-US")}` : ""}
                ${v.surface ? ` • ${escapeAttr(v.surface)}` : ""}
            </div>
            </div>
        </div>
    ` : "";

    return `
    <section class="team-page">
      <div class="team-header">
        <img class="slug ${slug}" src="${team.badge}" alt="${escapeAttr(team.name)} badge" height="72" loading="lazy">
        <div>
          <h2>${team.name} - ${team.nicknames?.[0] ?? ""}</h2>
          ${updatedLabel ? `<p class="muted">Last updated: ${updatedLabel}</p>` : ""}
        </div>
      </div>

      ${venueHtml}

      ${standingsRow && all ? `
        <div class="team-strip" role="group" aria-label="Team table summary">
          <div><span class="muted">Position</span>
            <strong>
                <a class="tbl-link" href="/epl/2025-26/table/#${standingsRow.rank}">${standingsRow.rank} ▷</a>
            </strong>
          </div>
          <div><span class="muted">Points</span><strong>${standingsRow.points}</strong></div>
          <div><span class="muted">GD</span><strong>${standingsRow.gd >= 0 ? "+" : ""}${standingsRow.gd}</strong></div>
          <div><span class="muted">Record</span><strong>${all.w}-${all.d}-${all.l}</strong></div>
          <div><span class="muted">Played</span><strong>${all.p}</strong></div>
          <div><span class="muted">Form</span><strong class="mono">${[...escapeAttr(standingsRow.form ?? "")].reverse().join("")}</strong></div>
        </div>
      ` : ""}

    <h2 class="text-center">Matches</h2>
    <div class="table-scroll" role="region" aria-label="League table" tabindex="0">
        <table class="team-matches">
            <thead>
            <tr>
                <th scope="col">Date</th>
                <th scope="col">Opponent</th>
                <th scope="col">Score</th>
                <th scope="col">Status</th>
                <th scope="col">Match</th>
            </tr>
            </thead>
            <tbody>
            ${rowsHtml}
            </tbody>
        </table>
    </div>
    </section>
  `.trim();
}

function tableJsonLd({ seasonLabel, rows, teamsBySlug, apiIdToSlug }) {
    return {
        "@context": "https://schema.org",
        "@type": "ItemList",
        name: `English Premier League ${seasonLabel} league table`,
        itemListOrder: "https://schema.org/ItemListOrderAscending",
        numberOfItems: rows.length,
        itemListElement: rows.map((r, i) => {
            const slug = apiIdToSlug.get(r.teamApiId);
            const team = teamsBySlug[slug];
            return {
                "@type": "ListItem",
                position: i + 1,
                item: teamToJsonLd(team)
            };
        })
    };
}

function teamPageJsonLd({ team, seasonLabel }) {
    return {
        "@context": "https://schema.org",
        ...teamToJsonLd(team),
        sport: "https://schema.org/Soccer",
        description: `${team.name} EPL ${seasonLabel} season page with results and match timelines by matchweek.`
    };
}

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

function setMetaProperty(html, property, content) {
    const safe = escapeAttr(content);
    const re = new RegExp(
        `<meta\\s+property=["']${property}["']\\s+content=["'][\\s\\S]*?["']\\s*\\/?>`,
        "i"
    );

    if (re.test(html)) {
        return html.replace(re, `<meta property="${property}" content="${safe}" />`);
    }
    return html.replace(
        "</head>",
        `  <meta property="${property}" content="${safe}" />\n</head>`
    );
}

function setMetaName(html, name, content) {
    const safe = escapeAttr(content);
    const re = new RegExp(
        `<meta\\s+name=["']${name}["']\\s+content=["'][\\s\\S]*?["']\\s*\\/?>`,
        "i"
    );

    if (re.test(html)) {
        return html.replace(re, `<meta name="${name}" content="${safe}" />`);
    }
    return html.replace("</head>", `  <meta name="${name}" content="${safe}" />\n</head>`);
}

function setOpenGraph(html, { title, description, url, image, siteName }) {
    let out = html;

    out = setMetaProperty(out, "og:type", "website");
    out = setMetaProperty(out, "og:site_name", siteName);
    out = setMetaProperty(out, "og:title", title);
    out = setMetaProperty(out, "og:description", description);
    out = setMetaProperty(out, "og:url", url);
    out = setMetaProperty(out, "og:image", image);

    // Optional but recommended if your OG image is always 1200x630:
    out = setMetaProperty(out, "og:image:width", "1200");
    out = setMetaProperty(out, "og:image:height", "630");

    return out;
}

function setTwitterCard(html, { title, description, image }) {
    let out = html;

    out = setMetaName(out, "twitter:card", "summary_large_image");
    out = setMetaName(out, "twitter:title", title);
    out = setMetaName(out, "twitter:description", description);
    out = setMetaName(out, "twitter:image", image);

    // Add twitter:site only if you have an actual handle.
    return out;
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

const HUB_STAT_ICONS = {
    goals: `<span class="evt-svg goal-ball" title="Goals">
        <svg width="18" height="18" viewBox="0 0 16 16"><use href="/img/misc/ball.svg"></use></svg>
    </span>`,
    ownGoals: `<span class="evt-svg og-goal-ball" title="Own Goals">
        <svg width="18" height="18" viewBox="0 0 16 16"><use href="/img/misc/ball.svg"></use></svg>
    </span>`,
    yellows: `<span class="card yellow" title="Yellow cards" aria-label="Yellow cards" role="img"></span>`,
    reds: `<span class="card red" title="Red cards" aria-label="Red cards" role="img"></span>`,
    var: `<span class="var-event" title="VAR events" aria-label="VAR events">VAR</span>`
};

function buildSeasonHubHtml({ seasonPath, seasonLabel, maxRound, matchweekMeta }) {

    const cards = Array.from({ length: maxRound }, (_, i) => {
        const round = i + 1;
        const displayRound = round.toString().padStart(2, "0");

        const meta = matchweekMeta?.[round] ?? {};
        const startDate = meta.startDate ?? "";
        const status = meta.status ?? "not-started";
        const stats = meta.stats ?? null;

        const dateLine = startDate || `EPL ${seasonLabel}`;

        const statusLabel =
            status === "completed"
                ? "Completed"
                : status === "in-progress"
                    ? "In Progress"
                    : "Not Started";

        const statusHtml = `
            <div class="mw-status mw-status--${status}">
                ${statusLabel}
            </div>
        `;

        const statsHtml =
            status !== "not-started" && stats
            ? `
                <div class="mw-stats" aria-label="Matchweek stats">
                    <span class="mw-stat">${HUB_STAT_ICONS.goals}<span class="mw-stat__num">${stats.goals}</span></span>
                    <span class="mw-stat">${HUB_STAT_ICONS.ownGoals}<span class="mw-stat__num">${stats.ownGoals}</span></span>
                    <span class="mw-stat">${HUB_STAT_ICONS.yellows}<span class="mw-stat__num">${stats.yellows}</span></span>
                    <span class="mw-stat">${HUB_STAT_ICONS.reds}<span class="mw-stat__num">${stats.reds}</span></span>
                    <span class="mw-stat">${HUB_STAT_ICONS.var}<span class="mw-stat__num">${stats.var}</span></span>
                </div>
            `
        : "";

        return `
                <a href="/epl/${seasonPath}/matchweek/${round}/" class="mw-card">
                    <div class="mw-number">${displayRound}</div>
                    <div class="mw-label">Matchweek</div>
                    <div class="mw-divider"></div>
                    <div class="mw-date">${dateLine}</div>
                    ${statusHtml}
                    ${statsHtml}
                </a>
            `;
        }).join("\n");

    return `
    <section class="season-hub">

        <div class="season-links">
            <a class="season-link" href="/epl/${seasonPath}/table/">League table &#9655;</a>
        </div>
        <h2>Matchweeks</h2>
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

function buildMatchweekPrevNextNav({ seasonPath, seasonLabel, round, maxRound }) {
    const prev = round > 1 ? `/epl/${seasonPath}/matchweek/${round - 1}/` : null;
    const next = round < maxRound ? `/epl/${seasonPath}/matchweek/${round + 1}/` : null;
    const hub = `/epl/${seasonPath}/`;

    return `
    <nav class="mw-nav" aria-label="Matchweek navigation">
      <a id="mw-hub" class="mw-nav__hub" href="${hub}">EPL ${seasonLabel} matchweeks</a>
      <div class="mw-nav__pager">
        ${prev ? `<a id="mw-prev" class="mw-nav__prev" href="${prev}" rel="prev">Matchweek ${round - 1}</a>` : `<span class="mw-nav__prev is-disabled" aria-disabled="true">Matchweek ${round - 1}</span>`}
        ${next ? `<a id="mw-next" class="mw-nav__next" href="${next}" rel="next">Matchweek ${round + 1} →</a>` : `<span class="mw-nav__next is-disabled" aria-disabled="true">Matchweek ${round + 1}</span>`}
      </div>
    </nav>
  `.trim();
}

function injectBeforeApp(html, extraHtml) {
    return html.replace('<div class="nav-container"></div>', `<div class="nav-container">${extraHtml}</div>`);
}

function normState(s) {
    return String(s ?? "").trim().toUpperCase();
}

function matchweekStatus(md) {
    const states = (md.matches || []).map(m => normState(m.status?.state)).filter(Boolean);
    if (!states.length) return "not-started";
    if (states.every(s => s === "FT")) return "completed";
    if (states.every(s => s === "NS")) return "not-started";
    return "in-progress";
}

function matchweekStats(md) {
    const out = { goals: 0, ownGoals: 0, yellows: 0, reds: 0, var: 0 };

    for (const m of md.matches || []) {
        for (const e of m.events || []) {
            const kind = String(e.kind || "").toLowerCase();
            const rawType = String(e.rawType || "").toLowerCase();
            const rawDetail = String(e.rawDetail || "").toLowerCase();

            if (rawType === "var" || kind.startsWith("var-")) { out.var++; continue; }

            if (kind === "goal" || kind === "own-goal" || rawType === "goal") {
                out.goals++;
                if (kind === "own-goal" || rawDetail === "own goal") out.ownGoals++;
                continue;
            }

            if (kind === "yellow") out.yellows++;
            if (kind === "red") out.reds++;
        }
    }

    return out;
}

async function buildMatchweekMetaMap(rounds) {
    const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", year: "numeric" });
    const out = {};

    for (const round of rounds) {
        const mdPath = path.join(MATCHDAYS_DIR, `${round}.json`);
        const md = JSON.parse(await fs.readFile(mdPath, "utf8"));

        const iso = getMatchweekStartKickoffISO(md);
        const startDate = iso ? fmt.format(new Date(iso)) : "";

        out[round] = {
            startDate,
            status: matchweekStatus(md),
            stats: matchweekStats(md),
        };
    }

    return out;
}

async function main() {

    const template = await fs.readFile(DIST_INDEX, "utf8");

    const seasonStart = 2025;        // data folder
    const seasonPath = "2025-26";   // URL path
    const seasonLabel = "2025–26";   // display label
    const maxRound = 38;
    const SITE_NAME = "Timeline";
    const OG_DEFAULT_IMAGE = "https://timelinefootball.com/og/og-default.png";

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

        const pagePath = `/epl/2025-26/matchweek/${round}/`;

        // NOTE: We'll swap this to your live domain in the SEO step.
        const canonical = `https://timelinefootball.com${pagePath}`;

        let out = template;
        out = setTitle(out, `EPL 2025–26 Matchweek ${round} Timelines | Timeline Football`);
        out = setDescription(
            out,
            `English Premier League 2025–26 Matchweek ${round} results with goals, cards, VAR and substitution timelines.`
        );
        out = setCanonical(out, canonical);

        const ogTitle = `EPL 2025–26 Matchweek ${round} Timelines | Timeline Football`;
        const ogDesc = `English Premier League 2025–26 Matchweek ${round} results with goals, cards, VAR and substitution timelines.`;

        out = setOpenGraph(out, {
            title: ogTitle,
            description: ogDesc,
            url: canonical,
            image: OG_DEFAULT_IMAGE,
            siteName: SITE_NAME,
        });

        out = setTwitterCard(out, {
            title: ogTitle,
            description: ogDesc,
            image: OG_DEFAULT_IMAGE,
        });

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
            seasonPath,
            seasonLabel,
            round,
            maxRound
        });

        out = injectBeforeApp(out, navHtml);

        out = injectApp(out, appHtml);

        const outDir = path.join(ROOT, "dist", "epl", String(seasonPath), "matchweek", String(round));
        await fs.mkdir(outDir, { recursive: true });
        await fs.writeFile(path.join(outDir, "index.html"), out, "utf8");

        console.log(`Prerendered ${pagePath}`);
    }

    const hubPath = `/epl/${seasonPath}/`;
    const canonical = `https://timelinefootball.com${hubPath}`;

    let out = template;

    out = setTitle(out, `EPL ${seasonLabel} Matchweeks 1–${maxRound} | Timeline Football`);
    out = setDescription(
        out,
        `Browse English Premier League ${seasonLabel} match timelines by matchweek (1–${maxRound}).`
    );

    out = setCanonical(out, canonical);

    const ogTitle = `EPL ${seasonLabel} Matchweeks 1–${maxRound} | Timeline Football`;
    const ogDesc = `Browse English Premier League ${seasonLabel} match timelines by matchweek (1–${maxRound}).`;

    out = setOpenGraph(out, {
        title: ogTitle,
        description: ogDesc,
        url: canonical,
        image: OG_DEFAULT_IMAGE,
        siteName: SITE_NAME,
    });

    out = setTwitterCard(out, {
        title: ogTitle,
        description: ogDesc,
        image: OG_DEFAULT_IMAGE,
    });

    const matchweekMeta = await buildMatchweekMetaMap(rounds);

    const hubHtml = buildSeasonHubHtml({
        seasonPath,
        seasonLabel,
        maxRound,
        matchweekMeta
    });

    out = injectApp(out, hubHtml);

    // write it
    const seasonOutDir = path.join(ROOT, "dist", "epl", String(seasonPath));
    await fs.mkdir(seasonOutDir, { recursive: true });

    const hubOutFile = path.join(seasonOutDir, "index.html");

    // IMPORTANT: hub should not boot the SPA
    out = stripAppScripts(out);

    // hub should not show matchweek dropdown/button
    out = stripMatchdayShell(out);
    await fs.writeFile(hubOutFile, out, "utf8");

    // ------------------------------
    // Table + Team pages
    // ------------------------------
    const standingsJson = JSON.parse(await fs.readFile(STANDINGS_PATH, "utf8"));
    const standingsRows = getStandingsRows(standingsJson);

    const apiIdToSlug = buildApiTeamIdToSlugMap(teams);

    // standings timestamp (use whatever you store; adapt key names here)
    const updatedISO = standingsJson.updated || standingsJson.updatedAt || standingsJson.lastUpdated || null;
    const updatedLabel = updatedISO ? formatISODate(updatedISO) : "";

    // Load all matchdays once (for team match lists)
    const roundsData = [];
    for (const round of rounds) {
        const mdPath = path.join(MATCHDAYS_DIR, `${round}.json`);
        roundsData.push(JSON.parse(await fs.readFile(mdPath, "utf8")));
    }

    const matchesByTeam = buildTeamMatchesIndex({ roundsData, teamsBySlug: teams, seasonPath });

    // standings lookup
    const standingsByApiId = new Map(standingsRows.map(r => [r.teamApiId, r]));

    // ---- Table page ----
    {
        const pagePath = `/epl/${seasonPath}/table/`;
        const canonical = `https://timelinefootball.com${pagePath}`;

        let page = template;

        const title = `EPL ${seasonLabel} Table | Timeline Football`;
        const desc = `English Premier League ${seasonLabel} league table with points, goal difference, form, and links to each team’s results and timelines.`;

        page = setTitle(page, title);
        page = setDescription(page, desc);
        page = setCanonical(page, canonical);

        page = setOpenGraph(page, {
            title,
            description: desc,
            url: canonical,
            image: OG_DEFAULT_IMAGE,
            siteName: SITE_NAME,
        });

        page = setTwitterCard(page, {
            title,
            description: desc,
            image: OG_DEFAULT_IMAGE,
        });

        const navHtml = `<nav class="mw-nav" aria-label="EPL navigation">
        <a class="mw-nav__hub" href="/epl/${seasonPath}/">EPL ${seasonLabel} matchweeks &#9655;</a>
        <div class="mw-nav__pager">
          <span class="mw-nav__prev is-disabled" aria-disabled="true"></span>
          <span class="mw-nav__next is-disabled" aria-disabled="true"></span>
        </div>
      </nav>`;
        page = injectBeforeApp(page, navHtml);

        const tableHtml = buildLeagueTableHtml({
            seasonPath,
            seasonLabel,
            rows: standingsRows,
            teamsBySlug: teams,
            apiIdToSlug,
            updatedLabel
        });

        page = injectApp(page, tableHtml);

        page = setJsonLd(page, tableJsonLd({ seasonLabel, rows: standingsRows, teamsBySlug: teams, apiIdToSlug }));

        // Table page should not boot SPA and should not show matchday shell
        page = stripAppScripts(page);
        page = stripMatchdayShell(page);

        const outDir = path.join(ROOT, "dist", "epl", String(seasonPath), "table");
        await fs.mkdir(outDir, { recursive: true });
        await fs.writeFile(path.join(outDir, "index.html"), page, "utf8");

        console.log(`Prerendered ${pagePath}`);
    }

    // ---- Team pages ----
    for (const [slug, team] of Object.entries(teams)) {
        const pagePath = `/epl/${seasonPath}/team/${slug}/`;
        const canonical = `https://timelinefootball.com${pagePath}`;

        let page = template;

        const standingsRow = standingsByApiId.get(team.apiTeamId) || null;

        const title = `${team.name} EPL ${seasonLabel} | Results & Match Timelines`;
        const desc = `${team.name} EPL ${seasonLabel} season page: current league position, results list, and links to matchweek timelines.`;

        page = setTitle(page, title);
        page = setDescription(page, desc);
        page = setCanonical(page, canonical);

        page = setOpenGraph(page, {
            title,
            description: desc,
            url: canonical,
            image: OG_DEFAULT_IMAGE,
            siteName: SITE_NAME,
        });

        page = setTwitterCard(page, {
            title,
            description: desc,
            image: OG_DEFAULT_IMAGE,
        });

        const navHtml = `<nav class="mw-nav" aria-label="EPL navigation">
        <a class="mw-nav__hub" href="/epl/${seasonPath}/">EPL ${seasonLabel} matchweeks &#9655;</a>
        <div class="mw-nav__pager">
          <a class="mw-nav__prev" href="/epl/${seasonPath}/table/">League table &#9655;</a>
          <span class="mw-nav__next is-disabled" aria-disabled="true"></span>
        </div>
      </nav>`;
        page = injectBeforeApp(page, navHtml);

        const teamHtml = buildTeamPageHtml({
            seasonPath,
            seasonLabel,
            slug,
            team,
            standingsRow,
            matches: matchesByTeam[slug] || [],
            updatedLabel
        });

        page = injectApp(page, teamHtml);

        page = setJsonLd(page, teamPageJsonLd({ team, seasonLabel }));

        page = stripAppScripts(page);
        page = stripMatchdayShell(page);

        const outDir = path.join(ROOT, "dist", "epl", String(seasonPath), "team", slug);
        await fs.mkdir(outDir, { recursive: true });
        await fs.writeFile(path.join(outDir, "index.html"), page, "utf8");

        console.log(`Prerendered ${pagePath}`);
    }

    console.log("Prerendered /epl/2025-26/");

}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});