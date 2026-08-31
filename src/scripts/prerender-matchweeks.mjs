import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getSeasonConfigFromEnv } from "../config/seasons.js";
import { renderMatchweekHTML } from "../lib/prerender/render.js";
import { getMatchPagePath } from "../lib/matchUrls.js";
import { sortedEvents } from "../lib/utils.js";

import { computePerfExec } from "../lib/powerMeter.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// repo root (src/scripts -> src -> root)
const ROOT = path.join(__dirname, "../..");
const season = getSeasonConfigFromEnv();

const DIST_INDEX = path.join(ROOT, "dist", "index.html");
const MATCHDAYS_DIR = path.join(
    ROOT,
    "public",
    "data",
    "leagues",
    season.leagueKey,
    season.seasonPath,
    "matchweeks"
);

const STANDINGS_PATH = path.join(
    ROOT,
    "public",
    "data",
    "leagues",
    season.leagueKey,
    season.seasonPath,
    "standings.json"
);

const ODDS_PATH = path.join(
    ROOT,
    "public",
    "data",
    "leagues",
    season.leagueKey,
    season.seasonPath,
    "odds.json"
);

async function readJsonIfExists(filePath, fallback) {
    try {
        const text = await fs.readFile(filePath, "utf8");
        return JSON.parse(text.replace(/^\uFEFF/, ""));
    } catch (err) {
        if (err?.code === "ENOENT") return fallback;
        throw err;
    }
}

function countOddsFixtures(oddsJson) {
    return Object.keys(oddsJson?.fixtures ?? {}).length;
}

async function fetchLiveOddsJson() {
    if (season.isArchived) return null;

    const url = `https://timelinefootball.com/data/leagues/${season.leagueKey}/${season.seasonPath}/odds.json`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) {
            console.warn(`Live odds hydration skipped: ${res.status} ${res.statusText}`);
            return null;
        }

        const oddsJson = await res.json();
        return countOddsFixtures(oddsJson) ? oddsJson : null;
    } catch (err) {
        console.warn(`Live odds hydration skipped: ${err?.message ?? err}`);
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

async function loadOddsForPrerender() {
    const localOdds = await readJsonIfExists(ODDS_PATH, null);
    if (countOddsFixtures(localOdds)) return localOdds;

    const liveOdds = await fetchLiveOddsJson();
    if (liveOdds) {
        console.log(`Hydrated odds from live site: ${countOddsFixtures(liveOdds)} fixtures`);
        return liveOdds;
    }

    return { fixtures: {} };
}

async function writeDistOdds(oddsJson) {
    if (!countOddsFixtures(oddsJson)) return;

    const distOddsPath = path.join(
        ROOT,
        "dist",
        "data",
        "leagues",
        season.leagueKey,
        season.seasonPath,
        "odds.json"
    );
    await fs.mkdir(path.dirname(distOddsPath), { recursive: true });
    await fs.writeFile(distOddsPath, JSON.stringify(oddsJson, null, 2), "utf8");
}

function attachMatchData(matches, oddsByFixture, round, seasonPath) {
    return (matches || []).map((match) => {
        const odds = oddsByFixture?.[String(match.id)];
        const matchPagePath = getMatchPagePath({
            seasonPath,
            round,
            homeTeamId: match.homeTeamId,
            awayTeamId: match.awayTeamId,
        });

        return {
            ...match,
            round,
            ...(matchPagePath ? { matchPagePath } : {}),
            ...(odds ? { odds } : {}),
        };
    });
}

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

function sortStandingsRowsForDisplay(rows, teamsBySlug, apiIdToSlug) {
    const isPreseason = rows.length > 0 && rows.every((r) => {
        const all = r.all || {};
        return Number(all.p ?? 0) === 0 &&
            Number(r.points ?? 0) === 0 &&
            Number(r.gd ?? 0) === 0;
    });

    if (!isPreseason) return rows;

    return [...rows]
        .sort((a, b) => {
            const aSlug = apiIdToSlug.get(a.teamApiId);
            const bSlug = apiIdToSlug.get(b.teamApiId);
            const aName = teamsBySlug[aSlug]?.name ?? a.teamName ?? aSlug ?? "";
            const bName = teamsBySlug[bSlug]?.name ?? b.teamName ?? bSlug ?? "";
            return aName.localeCompare(bName);
        })
        .map((row, index) => ({
            ...row,
            rank: index + 1,
            status: "same",
            description: null,
        }));
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
        <td class="text-center">${renderFormSequence(r.form ?? "")}</td>
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
            const href = getMatchPagePath({
                seasonPath,
                round,
                homeTeamId: home,
                awayTeamId: away,
            }) ?? `/epl/${seasonPath}/matchweek/${round}/#fixture-${fixtureId}`;

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

function renderFormSequence(formStr = "") {
    const arr = [...String(formStr)].reverse(); // keep your reverse logic

    return arr.map((r) => {
        const cls = r === "W" ? "form-W" :
            r === "D" ? "form-D" :
                r === "L" ? "form-L" : "";

        return `<span class="form-char ${cls}">${r}</span>`;
    }).join("");
}

function ordinal(n) {
    const num = Number(n);
    if (!Number.isFinite(num)) return "-";
    const mod100 = num % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${num}th`;
    switch (num % 10) {
        case 1: return `${num}st`;
        case 2: return `${num}nd`;
        case 3: return `${num}rd`;
        default: return `${num}th`;
    }
}

function parsePossession(value) {
    if (value == null) return null;
    const n = Number(String(value).replace("%", ""));
    return Number.isFinite(n) ? n : null;
}

function isCountedVarEvent(evt) {
    const kind = String(evt?.kind || "").toLowerCase();
    return kind.startsWith("var-") && kind !== "var-goal-confirmed" && kind !== "var-pen-confirmed";
}

function rankMetric(rows, key, direction = "desc") {
    const sorted = rows
        .filter((row) => Number.isFinite(row[key]))
        .sort((a, b) => {
            const diff = direction === "asc" ? a[key] - b[key] : b[key] - a[key];
            return diff || a.name.localeCompare(b.name);
        });

    const ranks = new Map();
    let previousValue = null;
    let previousRank = 0;

    sorted.forEach((row, index) => {
        const value = row[key];
        const rank = previousValue === value ? previousRank : index + 1;
        ranks.set(row.slug, rank);
        previousValue = value;
        previousRank = rank;
    });

    return ranks;
}

function buildLeaguePerformance({ roundsData, teamsBySlug }) {
    const rows = Object.entries(teamsBySlug).map(([slug, team]) => ({
        slug,
        name: team.name || slug,
        played: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        xg: 0,
        shots: 0,
        possTotal: 0,
        possCount: 0,
        yellowCards: 0,
        redCards: 0,
        varEvents: 0,
    }));
    const bySlug = new Map(rows.map((row) => [row.slug, row]));

    function addSide(match, side, slug, goalsFor, goalsAgainst) {
        const row = bySlug.get(slug);
        if (!row) return;

        const stats = match.statistics?.[side] || {};
        const poss = parsePossession(stats.poss);

        row.played += 1;
        row.goalsFor += Number(goalsFor) || 0;
        row.goalsAgainst += Number(goalsAgainst) || 0;
        row.xg += Number(stats.xg) || 0;
        row.shots += Number(stats.shots) || 0;
        row.yellowCards += Number(stats.yc) || 0;
        row.redCards += Number(stats.rc) || 0;

        if (poss != null) {
            row.possTotal += poss;
            row.possCount += 1;
        }
    }

    for (const md of roundsData || []) {
        for (const match of md.matches || []) {
            const state = String(match.status?.state || "").toUpperCase();
            if (!isCompletedState(state)) continue;

            const homeSlug = match.homeTeamId;
            const awaySlug = match.awayTeamId;
            const homeGoals = Number(match?.score?.home ?? 0);
            const awayGoals = Number(match?.score?.away ?? 0);

            addSide(match, "home", homeSlug, homeGoals, awayGoals);
            addSide(match, "away", awaySlug, awayGoals, homeGoals);

            for (const evt of match.events || []) {
                if (!isCountedVarEvent(evt)) continue;
                const side = String(evt.team || "").toLowerCase();
                const slugForEvent = side === "home" ? homeSlug : side === "away" ? awaySlug : null;
                const row = slugForEvent ? bySlug.get(slugForEvent) : null;
                if (row) row.varEvents += 1;
            }
        }
    }

    for (const row of rows) {
        row.possession = row.possCount ? row.possTotal / row.possCount : null;
    }

    const rowsWithPossession = rows.filter((row) => row.possession != null);
    const ranks = {
        goalsFor: rankMetric(rows, "goalsFor", "desc"),
        goalsAgainst: rankMetric(rows, "goalsAgainst", "asc"),
        xg: rankMetric(rows, "xg", "desc"),
        shots: rankMetric(rows, "shots", "desc"),
        possession: rankMetric(rowsWithPossession, "possession", "desc"),
        yellowCards: rankMetric(rows, "yellowCards", "asc"),
        redCards: rankMetric(rows, "redCards", "asc"),
        varEvents: rankMetric(rows, "varEvents", "desc"),
    };

    const out = {};
    for (const row of rows) {
        out[row.slug] = {
            rows: [
                { label: "Goals scored", value: row.goalsFor, rank: ranks.goalsFor.get(row.slug) },
                { label: "Goals conceded", value: row.goalsAgainst, rank: ranks.goalsAgainst.get(row.slug) },
                { label: "xG", value: row.played ? row.xg.toFixed(1) : "-", rank: ranks.xg.get(row.slug) },
                { label: "Shots", value: row.shots, rank: ranks.shots.get(row.slug) },
                { label: "Possession", value: row.possession == null ? "-" : `${Math.round(row.possession)}%`, rank: ranks.possession.get(row.slug) },
                { label: "Yellow cards", value: row.yellowCards, rank: ranks.yellowCards.get(row.slug) },
                { label: "Red cards", value: row.redCards, rank: ranks.redCards.get(row.slug) },
                { label: "VAR interventions", value: row.varEvents, rank: ranks.varEvents.get(row.slug), note: "Excludes goals and penalties confirmed" },
            ],
        };
    }

    return out;
}

function buildLeaguePerformanceHtml(team, leaguePerformance) {
    const rows = leaguePerformance?.rows || [];
    if (!rows.length) return "";

    return `
        <section class="league-performance" aria-label="${escapeAttr(team.name)} league performance rankings">
            <h2 class="text-center">League Statistics</h2>
            <div class="table-scroll" role="region" aria-label="${escapeAttr(team.name)} league performance table" tabindex="0">
                <table class="league-performance-table">
                    <thead>
                    <tr>
                        <th scope="col">Metric</th>
                        <th scope="col" class="text-center">${escapeAttr(team.name)}</th>
                        <th scope="col" class="text-center">EPL Rank</th>
                    </tr>
                    </thead>
                    <tbody>
                    ${rows.map((row) => `
                        <tr${row.note ? ` title="${escapeAttr(row.note)}"` : ""}>
                            <td>${escapeAttr(row.label)}</td>
                            <td class="text-center"><strong>${escapeAttr(row.value)}</strong></td>
                            <td class="text-center"><strong>${ordinal(row.rank)}</strong></td>
                        </tr>
                    `.trim()).join("\n")}
                    </tbody>
                </table>
            </div>
        </section>
    `.trim();
}

function buildTeamPageHtml({ seasonPath, seasonLabel, slug, team, standingsRow, matches, teamSeason, leaguePerformance, updatedLabel }) {
    const all = standingsRow?.all || null;

    const summary = standingsRow && all
        ? `${team.name} are ${standingsRow.rank}th in the EPL ${seasonLabel} table with ${standingsRow.points} points from ${all.p} matches (${all.w}W-${all.d}D-${all.l}L) and a goal difference of ${standingsRow.gd >= 0 ? "+" : ""}${standingsRow.gd}.`
        : `${team.name} EPL ${seasonLabel} season page with results and match timelines by matchweek.`;
    const ratingByFixtureId = new Map(
        (teamSeason?.matches || []).map((m) => [String(m.fixtureId), m.rating])
    );

    const rowsHtml = (matches || []).map((m) => {
        const date = m.kickoff ? formatISODate(m.kickoff) : "";
        const vsAt = m.isHome ? "H &nbsp;" : "A &nbsp;";
        const state = String(m.state || "").toUpperCase();
        const hasStarted = !["NS", "TBD", "PST", "CANC", "ABD", "SUSP", "INT"].includes(state);
        let score = hasStarted && m.scoreFor != null && m.scoreAgainst != null ? `${m.scoreFor}–${m.scoreAgainst}` : "–";
        const rating = ratingByFixtureId.get(String(m.fixtureId));
        const ratingText = typeof rating === "number" ? Math.round(rating) : "–";

        if (hasStarted && !m.isHome) score = `${m.scoreAgainst}–${m.scoreFor}`; // reverse for away matches

        return `
                <tr>
                    <td class="text-center">${date}</td>
                    <td>${vsAt} <strong><a class="tbl-link" href="/epl/${seasonPath}/team/${m.opponentSlug}/">${m.opponentName} &#9655;</a></strong></td>
                    <td class="text-center"><strong>${score}</strong></td>
                    <td class="text-center"><strong>${ratingText}</strong></td>
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

    const seasonSummaryHtml = teamSeason ? `
        <section class="team-season-performance">
            <h2 class="text-center">League Performance</h2>
            <div class="team-season-summary">
            <div title="Average Rating"><span class="muted">Avg Rating: </span><strong>${teamSeason.summary.avgRating ?? "-"}</strong></div>
            <div title="Average Match Control Index"><span class="muted">Avg mX: </span><strong>${teamSeason.summary.avgMx ?? "-"}</strong></div>
            <div title="Average Execution Index"><span class="muted">Avg eX: </span><strong>${teamSeason.summary.avgEx ?? "-"}</strong></div>
            </div>
        </section>
    ` : "";
    const leaguePerformanceHtml = buildLeaguePerformanceHtml(team, leaguePerformance);

    const chartId = `team-trend-chart-${slug}`;

    const teamChartHtml = teamSeason ? `
        <section class="team-chart-section">
            <h2 class="text-center">Season Trends</h2>

            <div class="team-chart-block">
                <h3 class="team-chart-title text-center">Rating</h3>
                <div class="team-chart-wrap">
                    <canvas id="${chartId}-rating" aria-label="${escapeAttr(team.name)} rating chart"></canvas>
                </div>
            </div>

            <div class="team-chart-block">
                <h3 class="team-chart-title text-center">Performance Breakdown</h3>
                <div class="team-chart-wrap team-chart-wrap-compact">
                    <canvas id="${chartId}-perf" aria-label="${escapeAttr(team.name)} performance breakdown chart"></canvas>
                </div>
            </div>
            <div class="chart-hint">Click a match to view details</div>
        </section>
    ` : "";

    const teamChartScript = teamSeason ? `
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script>
    (() => {
        const chartData = ${JSON.stringify(teamSeason.matches || [])};
        if (!Array.isArray(chartData) || !chartData.length) return;

        const ratingCanvas = document.getElementById(${JSON.stringify(chartId + "-rating")});
        const perfCanvas = document.getElementById(${JSON.stringify(chartId + "-perf")});
        if (!ratingCanvas || !perfCanvas) return;

        console.log("ratingCanvas:", ratingCanvas);
        console.log("perfCanvas:", perfCanvas);

        ratingCanvas.addEventListener("click", () => {
            console.log("RAW canvas click: rating");
        });

        perfCanvas.addEventListener("click", () => {
            console.log("RAW canvas click: perf");
        });

        const labels = chartData.map(m => m.mw);
        const ratingVals = chartData.map(m => m.rating ?? null);
        const mxVals = chartData.map(m => m.mx ?? null);
        const exDeltaVals = chartData.map(m => (
            typeof m.ex === "number" ? m.ex - 50 : null
        ));

        function rollingAvg(arr, window = 5) {
            return arr.map((_, i) => {
                const start = Math.max(0, i - window + 1);
                const slice = arr.slice(start, i + 1).filter(v => typeof v === "number");
                if (!slice.length) return null;
                return slice.reduce((a, b) => a + b, 0) / slice.length;
            });
        }

        const avgRating = ${JSON.stringify(teamSeason.summary.avgRating ?? 0)};

        function rollingAvg(arr, windowSize = 5) {
            return arr.map((_, i) => {
                if (typeof arr[i] !== "number" || !Number.isFinite(arr[i])) return null;

                const start = Math.max(0, i - windowSize + 1);
                const slice = arr
                    .slice(start, i + 1)
                    .filter(v => typeof v === "number" && Number.isFinite(v));

                if (!slice.length) return null;
                return slice.reduce((sum, v) => sum + v, 0) / slice.length;
            });
        }

        const rollingRatingVals = rollingAvg(ratingVals, 5);

        const resultColors = chartData.map(m => {
            if (m.result === "W") return "#16a34a";
            if (m.result === "D") return "#ca8a04";
            if (m.result === "L") return "#dc2626";
            return "rgba(107, 114, 128, 0.35)";
        });

        const exBarColors = exDeltaVals.map(v => {
            if (v == null) return "rgba(0,0,0,0)";
            return v >= 0
                ? "rgba(34, 197, 94, 0.48)"
                : "rgba(220, 38, 38, 0.42)";
        });

        const sharedTooltip = {
            callbacks: {
                title: (items) => {
                    const i = items[0].dataIndex;
                    const m = chartData[i];
                    return "MW " + m.mw + " • " + (m.homeAway === "H" ? "Home" : "Away");
                },
                beforeBody: (items) => {
                    const i = items[0].dataIndex;
                    const m = chartData[i];
                    const lines = [
                        (m.homeAway === "H" ? "vs " : "@ ") + (m.opponentName || m.opponent),
                    ];

                    if (m.result) {
                        lines.push("Score: " + m.score + " (" + m.result + ")");
                    } else {
                        lines.push("Status: " + (m.state || "NS"));
                    }

                    if (typeof m.rating === "number") lines.push("Rating: " + Math.round(m.rating));
                    if (typeof m.mx === "number") lines.push("mX: " + Math.round(m.mx));
                    if (typeof m.ex === "number") {
                        const delta = Math.round(m.ex - 50);
                        lines.push("eX Δ: " + (delta >= 0 ? "+" : "") + delta);
                    }

                    return lines;
                },
                label: () => ""
            },
            displayColors: false
        };

        const seasonPath = ${JSON.stringify(seasonPath)};

        function openMatchFromChart(match) {
            console.log("chart click match:", match);

            if (!match?.mw || !match?.fixtureId) {
                console.warn("Missing mw or fixtureId on chart match:", match);
                return;
            }

            const url = match.href || ("/epl/" + seasonPath + "/matchweek/" + match.mw + "/#fixture-" + match.fixtureId);
            window.location.assign(url);
        }

        new Chart(ratingCanvas, {
            type: "line",
            data: {
                labels,
                datasets: [
                    {
                        label: "Rating",
                        data: ratingVals,
                        borderColor: "#3b0a45",
                        backgroundColor: resultColors,
                        pointBackgroundColor: resultColors,
                        pointBorderColor: resultColors,
                        pointRadius: 4,
                        pointHoverRadius: 6,
                        pointBorderWidth: 0,
                        borderWidth: 4.5,
                        tension: 0.22,
                        order: 1
                    },
                    {
                        label: "Form (Last 5)",
                        data: rollingRatingVals,
                        borderColor: "rgba(59, 10, 69, 0.45)",
                        pointRadius: 0,
                        pointHoverRadius: 0,
                        borderWidth: 2.5,
                        tension: 0.28,
                        order: 2
                    },
                    {
                        label: "Season Avg",
                        data: Array(labels.length).fill(avgRating),
                        borderColor: "rgba(79, 92, 110, 0.35)",
                        borderDash: [6, 6],
                        pointRadius: 0,
                        pointHoverRadius: 0,
                        borderWidth: 2,
                        tension: 0,
                        order: 3
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: "nearest",
                    intersect: true
                },
                onClick: (event, elements) => {
                    if (!elements.length) return;
                    const index = elements[0].index;
                    openMatchFromChart(chartData[index]);
                },

                onHover: (event, elements, chart) => {
                    chart.canvas.style.cursor = elements.length ? "pointer" : "default";
                },
                plugins: {
                    tooltip: sharedTooltip,
                    legend: {
                        position: "top",
                        labels: {
                            boxWidth: 14,
                            color: "#4b5563",
                            usePointStyle: false
                        }
                    }
                },
                scales: {
                    y: {
                        position: "left",
                        min: 0,
                        max: 100,
                        grid: {
                            color: "rgba(0,0,0,0.05)"
                        },
                        ticks: {
                            color: "#6b7280",
                            maxTicksLimit: 6
                        }
                    },
                    x: {
                        grid: {
                            color: "rgba(0,0,0,0.03)"
                        },
                        ticks: {
                            color: "#6b7280",
                            maxRotation: 0,
                            autoSkip: false
                        }
                    }
                }
            }
        });

        new Chart(perfCanvas, {
            type: "bar",
            data: {
                labels,
                datasets: [
                    {
                        type: "bar",
                        label: "eX Δ",
                        data: exDeltaVals,
                        yAxisID: "yEx",
                        backgroundColor: exBarColors,
                        borderWidth: 0,
                        borderRadius: 1,
                        barPercentage: 0.72,
                        categoryPercentage: 0.82,
                        order: 2
                    },
                    {
                        type: "line",
                        label: "mX",
                        data: mxVals,
                        yAxisID: "y",
                        borderColor: "rgba(55, 65, 81, 0.65)",
                        pointRadius: 0,
                        pointHoverRadius: 0,
                        borderWidth: 2,
                        borderDash: [],
                        tension: 0.22,
                        order: 1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: "index",
                    intersect: false
                },
                onClick: (event, elements) => {
                    if (!elements.length) return;
                    const index = elements[0].index;
                    openMatchFromChart(chartData[index]);
                },

                onHover: (event, elements, chart) => {
                    chart.canvas.style.cursor = elements.length ? "pointer" : "default";
                },
                plugins: {
                    tooltip: sharedTooltip,
                    legend: {
                        position: "top",
                        labels: {
                            boxWidth: 14,
                            color: "#4b5563",
                            usePointStyle: false
                        }
                    }
                },
                scales: {
                    y: {
                        position: "left",
                        min: 0,
                        max: 100,
                        grid: {
                            color: "rgba(0,0,0,0.04)"
                        },
                        ticks: {
                            color: "#6b7280",
                            maxTicksLimit: 5
                        }
                    },
                    yEx: {
                        position: "right",
                        min: -50,
                        max: 50,
                        grid: {
                            drawOnChartArea: false
                        },
                        ticks: {
                            color: "#9ca3af",
                            callback: (v) => v > 0 ? "+" + v : v,
                            maxTicksLimit: 5
                        }
                    },
                    x: {
                        grid: {
                            color: "rgba(0,0,0,0.03)"
                        },
                        ticks: {
                            color: "#6b7280",
                            maxRotation: 0,
                            autoSkip: false
                        }
                    }
                }
            }
        });
    })();
    </script>
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
            <h2 class="text-center">League Summary</h2>
            <div class="team-strip" role="group" aria-label="Team table summary">
                <div><span class="muted">Position</span>
                    <strong>
                        <a class="tbl-link" href="/epl/${seasonPath}/table/#${standingsRow.rank}">${standingsRow.rank} ▷</a>
                    </strong>
                </div>
                <div><span class="muted">Points</span><strong>${standingsRow.points}</strong></div>
                <div><span class="muted">GD</span><strong>${standingsRow.gd >= 0 ? "+" : ""}${standingsRow.gd}</strong></div>
                <div><span class="muted">Record</span><strong>${all.w}-${all.d}-${all.l}</strong></div>
                <div><span class="muted">Played</span><strong>${all.p}</strong></div>
                <div><span class="muted">Form</span><strong class="form-seq">${renderFormSequence(standingsRow.form ?? "")}</strong></div>
            </div>
        ` : ""}

        ${leaguePerformanceHtml}
        ${seasonSummaryHtml}
        ${teamChartHtml}

        <h2 class="text-center">Matches</h2>
        <div class="table-scroll" role="region" aria-label="League table" tabindex="0">
            <table class="team-matches">
                <thead>
                <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Opponent</th>
                    <th scope="col">Score</th>
                    <th scope="col">Rating</th>
                    <th scope="col">Status</th>
                    <th scope="col">Match</th>
                </tr>
                </thead>
                <tbody>
                ${rowsHtml}
                </tbody>
            </table>
        </div>
         ${teamChartScript}
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

function setSeasonChrome(html, { seasonPath, seasonLabel, leagueName }) {
    return html
        .replace(
            /<h2 class="site-tagline">.*?<\/h2>/s,
            `<h2 class="site-tagline">${escapeAttr(leagueName)} ${escapeAttr(seasonLabel)}</h2>`
        )
        .replace(/href="\/epl\/\d{4}-\d{2}\/table\/"/g, `href="/epl/${seasonPath}/table/"`)
        .replace(/href="\/epl\/\d{4}-\d{2}\/"/g, `href="/epl/${seasonPath}/"`);
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
    if (st === "FT" || st === "AET" || st === "PEN") return "https://schema.org/EventCompleted";
    if (st === "HT" || st.includes("'")) return "https://schema.org/EventInProgress";
    if (st === "PST") return "https://schema.org/EventPostponed";

    return "https://schema.org/EventScheduled";
}

function matchToSportsEventLd(match, teamsById, pageUrl) {

    const home = teamsById[match.homeTeamId];
    const away = teamsById[match.awayTeamId];

    const homeName = home?.name ?? String(match.homeTeamId);
    const awayName = away?.name ?? String(match.awayTeamId);

    let eventName = ""

    // Optional: include final score only when FT
    if (String(match.status?.state || "").toUpperCase() === "FT") {
        eventName = `${homeName} ${match.score?.home}–${match.score?.away} ${awayName}`;
    } else {
        eventName = `${homeName} vs ${awayName}`;
    }

    const evt = {
        "@type": "SportsEvent",
        name: `${eventName}`,
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

function formatScoreForTitle(match) {
    const state = String(match.status?.state || "").toUpperCase();
    if (state === "NS" || state === "TBD" || state === "PST") return "vs";
    const home = match.score?.home ?? "-";
    const away = match.score?.away ?? "-";
    return `${home}-${away}`;
}

function formatOddsSummary(match, home, away) {
    const c = match.odds?.consensus;
    if (!c) return "";

    const homePct = Number(c.home);
    const drawPct = Number(c.draw);
    const awayPct = Number(c.away);

    if (![homePct, drawPct, awayPct].every(Number.isFinite)) return "";

    return `${home.display || home.name} ${homePct}%, draw ${drawPct}%, ${away.display || away.name} ${awayPct}%`;
}

function buildMatchStory({ match, home, away, seasonLabel, round }) {
    const state = String(match.status?.state || "").toUpperCase();
    const venue = match.venue ? ` at ${match.venue}` : "";
    const oddsSummary = formatOddsSummary(match, home, away);

    if (state === "FT") {
        const homeGoals = Number(match.score?.home ?? 0);
        const awayGoals = Number(match.score?.away ?? 0);
        let resultText = `${home.name} drew ${away.name} ${homeGoals}-${awayGoals}`;

        if (homeGoals > awayGoals) {
            resultText = `${home.name} beat ${away.name} ${homeGoals}-${awayGoals}`;
        } else if (awayGoals > homeGoals) {
            resultText = `${away.name} beat ${home.name} ${awayGoals}-${homeGoals}`;
        }

        return `${resultText}${venue} in EPL ${seasonLabel} Matchweek ${round}.${oddsSummary ? ` Pre-match odds: ${oddsSummary}.` : ""}`;
    }

    return `${home.name} face ${away.name}${venue} in EPL ${seasonLabel} Matchweek ${round}.${oddsSummary ? ` Pre-match odds: ${oddsSummary}.` : ""}`;
}

function buildKeyMomentsHtml(match) {
    const events = sortedEvents(match.events || []).filter((evt) => {
        return [
            "goal",
            "own-goal",
            "penalty-miss",
            "red",
            "var-goal-cancelled",
            "var-goal-disallowed-offside",
            "var-goal-disallowed",
            "var-pen-cancelled",
            "var-pen-confirmed",
        ].includes(evt.kind);
    });

    if (!events.length) return "";

    const rows = events.slice(0, 8).map((evt) => {
        const minute = evt.minute || (evt.elapsed ? `${evt.elapsed}'` : "");
        const label = evt.kind
            .replace(/^var-/, "VAR ")
            .replace(/-/g, " ");
        const player = evt.player ? ` - ${evt.player}` : "";
        return `<li><span class="match-moment__minute">${escapeAttr(minute)}</span><span>${escapeAttr(label)}${escapeAttr(player)}</span></li>`;
    }).join("");

    return `
        <section class="match-page-section">
            <h2>Key moments</h2>
            <ol class="match-moments">${rows}</ol>
        </section>
    `;
}

function matchPageJsonLd({ match, home, away, pageUrl }) {
    const event = matchToSportsEventLd(match, {
        [match.homeTeamId]: home,
        [match.awayTeamId]: away,
    }, pageUrl);
    event.url = pageUrl;

    return {
        "@context": "https://schema.org",
        ...event,
    };
}

function shareIcon(name) {
    const paths = {
        x: `<path d="M18.9 2h3.4l-7.5 8.6 8.8 11.4h-6.9l-5.4-7-6.2 7H1.7l8-9.1L1.2 2h7.1l4.9 6.4L18.9 2Zm-1.2 18h1.9L7.3 3.9h-2L17.7 20Z"/>`,
        facebook: `<path d="M14 8.6h3V5h-3c-3.2 0-5.2 2-5.2 5.1V13H6v3.7h2.8V22h4.1v-5.3h3.3l.6-3.7h-3.9v-2.5c0-1.1.4-1.9 1.1-1.9Z"/>`,
        whatsapp: `<path d="M20.5 3.5A11.2 11.2 0 0 0 2.9 17l-1 5.1 5.2-1a11.2 11.2 0 0 0 13.4-17.6Zm-8.4 16a9 9 0 0 1-4.5-1.2l-.3-.2-3.1.6.6-3-.2-.4a9 9 0 1 1 7.5 4.2Zm5-6.7c-.3-.2-1.8-.9-2.1-1-.3-.1-.5-.2-.7.2l-.9 1c-.2.2-.3.2-.6.1a7.4 7.4 0 0 1-3.7-3.2c-.2-.3 0-.5.1-.6l.5-.6c.2-.2.2-.3.3-.5.1-.2.1-.4 0-.6l-1-2c-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4-.3.4-1.2 1.2-1.2 2.8s1.2 3.2 1.4 3.4c.2.2 2.4 3.7 5.8 5.1.8.4 1.5.6 2 .7.8.3 1.6.2 2.2.1.7-.1 1.8-.8 2.1-1.5.3-.7.3-1.3.2-1.5-.1-.1-.3-.2-.6-.3Z"/>`,
        instagram: `<path d="M7.8 2h8.4A5.8 5.8 0 0 1 22 7.8v8.4a5.8 5.8 0 0 1-5.8 5.8H7.8A5.8 5.8 0 0 1 2 16.2V7.8A5.8 5.8 0 0 1 7.8 2Zm-.2 2A3.6 3.6 0 0 0 4 7.6v8.8A3.6 3.6 0 0 0 7.6 20h8.8a3.6 3.6 0 0 0 3.6-3.6V7.6A3.6 3.6 0 0 0 16.4 4H7.6Zm9.7 1.5a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6ZM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"/>`,
        tiktok: `<path d="M16.6 2c.4 3 2.1 4.8 5 5v3.4a8.6 8.6 0 0 1-5-1.6v6.6c0 4.2-2.5 6.6-6.2 6.6A6.1 6.1 0 0 1 4 15.9c0-3.7 2.8-6.3 6.6-6.3.5 0 .9 0 1.3.1v3.5c-.4-.1-.8-.2-1.3-.2-1.8 0-3 1.1-3 2.8 0 1.6 1.1 2.7 2.6 2.7 1.7 0 2.7-1 2.7-3.2V2h3.7Z"/>`,
        email: `<path d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm1.8 2 7.2 5.4L19.2 7H4.8Zm15.2 2.2-7.4 5.5a1 1 0 0 1-1.2 0L4 9.2V17h16V9.2Z"/>`,
    };

    return `<svg class="match-page-share__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name] || ""}</svg>`;
}

function buildShareLinks({ title, pageUrl, story }) {
    const encodedUrl = encodeURIComponent(pageUrl);
    const encodedTitle = encodeURIComponent(title);
    const encodedText = encodeURIComponent(`${title} - ${story}`);
    const encodedEmailBody = encodeURIComponent(`${title}\n${story}\n\n${pageUrl}`);
    const encodedCopyText = encodeURIComponent(`${title}\n${story}\n\n${pageUrl}`);
    const encodedStory = encodeURIComponent(story);

    return `
                <nav class="match-page-share" aria-label="Share this match">
                    <span class="match-page-share__title">Share</span>
                    <a href="https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}" rel="noopener noreferrer" target="_blank" aria-label="Share on X" title="Share on X">${shareIcon("x")}<span class="sr-only">X</span></a>
                    <a href="https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}" rel="noopener noreferrer" target="_blank" aria-label="Share on Facebook" title="Share on Facebook">${shareIcon("facebook")}<span class="sr-only">Facebook</span></a>
                    <a href="https://api.whatsapp.com/send?text=${encodedText}%20${encodedUrl}" rel="noopener noreferrer" target="_blank" aria-label="Share on WhatsApp" title="Share on WhatsApp">${shareIcon("whatsapp")}<span class="sr-only">WhatsApp</span></a>
                    <button type="button" data-share-native data-share-platform="Instagram" data-share-title="${encodedTitle}" data-share-story="${encodedStory}" data-share-url="${encodedUrl}" data-share-text="${encodedCopyText}" aria-label="Share or copy for Instagram" title="Share or copy for Instagram">${shareIcon("instagram")}<span class="sr-only">Instagram</span></button>
                    <button type="button" data-share-native data-share-platform="TikTok" data-share-title="${encodedTitle}" data-share-story="${encodedStory}" data-share-url="${encodedUrl}" data-share-text="${encodedCopyText}" aria-label="Share or copy for TikTok" title="Share or copy for TikTok">${shareIcon("tiktok")}<span class="sr-only">TikTok</span></button>
                    <a href="mailto:?subject=${encodedTitle}&body=${encodedEmailBody}" aria-label="Share by email" title="Share by email">${shareIcon("email")}<span class="sr-only">Email</span></a>
                    <span class="match-page-share__status" aria-live="polite"></span>
                </nav>
    `;
}

function matchPageToggleScript() {
    return `
        <script>
            document.addEventListener("click", function (event) {
                var button = event.target.closest(".match-page .timeline-toggle");
                if (!button) return;

                var card = button.closest(".match-card");
                if (!card) return;

                var resultOnly = !card.classList.contains("is-result-only");
                card.classList.toggle("is-result-only", resultOnly);
                button.setAttribute("aria-expanded", resultOnly ? "false" : "true");
                button.textContent = resultOnly ? "Show Timeline" : "Show Result";
            });

            document.addEventListener("click", function (event) {
                var button = event.target.closest("[data-share-native], [data-share-copy]");
                if (!button) return;

                var platform = button.getAttribute("data-share-platform") || "share";
                var title = decodeURIComponent(button.getAttribute("data-share-title") || "");
                var story = decodeURIComponent(button.getAttribute("data-share-story") || "");
                var url = decodeURIComponent(button.getAttribute("data-share-url") || "") || window.location.href;
                var text = decodeURIComponent(button.getAttribute("data-share-text") || "") || window.location.href;
                var originalLabel = button.getAttribute("aria-label") || "Copy match link";
                var status = button.parentElement ? button.parentElement.querySelector(".match-page-share__status") : null;

                function setCopied() {
                    button.setAttribute("aria-label", "Copied for " + platform);
                    button.classList.add("is-copied");
                    if (status) status.textContent = "Copied for " + platform;
                    window.setTimeout(function () {
                        button.setAttribute("aria-label", originalLabel);
                        button.classList.remove("is-copied");
                        if (status) status.textContent = "";
                    }, 1400);
                }

                function copyShareText() {
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(text).then(setCopied).catch(function () {});
                        return;
                    }

                    var field = document.createElement("textarea");
                    field.value = text;
                    field.setAttribute("readonly", "");
                    field.style.position = "fixed";
                    field.style.left = "-9999px";
                    document.body.appendChild(field);
                    field.select();
                    try {
                        document.execCommand("copy");
                        setCopied();
                    } catch (err) {
                        if (status) status.textContent = "Copy unavailable";
                    }
                    document.body.removeChild(field);
                }

                if (button.hasAttribute("data-share-native") && navigator.share) {
                    navigator.share({ title: title, text: story, url: url }).catch(copyShareText);
                    return;
                }

                copyShareText();
            });
        </script>
    `;
}

function buildMatchPageHtml({ match, home, away, players, seasonPath, seasonLabel, round }) {
    const story = buildMatchStory({ match, home, away, seasonLabel, round });
    const matchweekHref = `/epl/${seasonPath}/matchweek/${round}/`;
    const tableHref = `/epl/${seasonPath}/table/`;
    const homeHref = `/epl/${seasonPath}/team/${match.homeTeamId}/`;
    const awayHref = `/epl/${seasonPath}/team/${match.awayTeamId}/`;
    const status = escapeAttr(match.status?.state || "");
    const score = formatScoreForTitle(match);
    const title = `${home.name} ${score} ${away.name}`;
    const pageUrl = `https://timelinefootball.com${getMatchPagePath({
        seasonPath,
        round,
        homeTeamId: match.homeTeamId,
        awayTeamId: match.awayTeamId,
    })}`;

    return `
        <section class="match-page">
            <header class="match-page-hero">
                <p class="match-page-kicker">EPL ${seasonLabel} Matchweek ${round}</p>
                <h1>${escapeAttr(title)}</h1>
                <p class="match-page-summary">${escapeAttr(story)}</p>
                <nav class="match-page-links" aria-label="Match links">
                    <a href="${homeHref}">${escapeAttr(home.display || home.name)} &#9655;</a>
                    <a href="${awayHref}">${escapeAttr(away.display || away.name)} &#9655;</a>
                    <a href="${matchweekHref}">Matchweek ${round} &#9655;</a>
                    <a href="${tableHref}">EPL table &#9655;</a>
                </nav>
                ${buildShareLinks({ title, pageUrl, story })}
            </header>

            <div class="match-page-card">
                ${renderMatchweekHTML({
                    matches: [match],
                    teams: {
                        [match.homeTeamId]: home,
                        [match.awayTeamId]: away,
                    },
                    players,
                    seasonPath,
                    globalMode: "compact",
                })}
            </div>

            <section class="match-page-section match-page-facts">
                <h2>Match context</h2>
                <dl>
                    <div><dt>Status</dt><dd>${status}</dd></div>
                    <div><dt>Venue</dt><dd>${escapeAttr(match.venue || "TBD")}</dd></div>
                    <div><dt>Matchweek</dt><dd><a href="${matchweekHref}">${round}</a></dd></div>
                </dl>
            </section>

            ${buildKeyMomentsHtml(match)}
        </section>
        ${matchPageToggleScript()}
    `;
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
      <a id="mw-hub" class="mw-nav__hub" href="${hub}">EPL ${seasonLabel} Matchweeks</a>
      <div class="mw-nav__pager">
        ${prev ? `<a id="mw-prev" class="mw-nav__prev" href="${prev}" rel="prev">Matchweek ${round - 1}</a>` : `<span id="mw-prev" class="mw-nav__prev is-disabled" aria-disabled="true"></span>`}
        ${next ? `<a id="mw-next" class="mw-nav__next" href="${next}" rel="next">Matchweek ${round + 1} →</a>` : `<span id="mw-next" class="mw-nav__next is-disabled" aria-disabled="true"></span>`}
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


function averageOrNull(arr) {
    if (!arr.length) return null;
    return Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1));
}

function isCompletedState(state) {
    const s = String(state || "").toUpperCase().trim();
    return s === "FT";
}

function buildTeamSeason({ roundsData, teamsBySlug }) {
    const out = {};

    for (const slug of Object.keys(teamsBySlug)) {
        out[slug] = {
            summary: {
                played: 0,
                wins: 0,
                draws: 0,
                losses: 0,
                gf: 0,
                ga: 0,
                gd: 0,
                points: 0,
                avgMx: null,
                avgEx: null,
                avgRating: null,
                last5: []
            },
            matches: []
        };
    }

    for (const md of roundsData) {
        const mw = md.round;

        for (const match of md.matches || []) {

            const state = String(match.status?.state || "").toUpperCase();

            const homeSlug = match.homeTeamId;
            const awaySlug = match.awayTeamId;

            if (!out[homeSlug] || !out[awaySlug]) continue;

            const isCompleted = isCompletedState(state);
            const homeGoals = Number(match?.score?.home ?? 0);
            const awayGoals = Number(match?.score?.away ?? 0);

            const homeResult =
                !isCompleted ? null :
                homeGoals > awayGoals ? "W" :
                    homeGoals < awayGoals ? "L" : "D";

            const awayResult =
                !isCompleted ? null :
                awayGoals > homeGoals ? "W" :
                    awayGoals < homeGoals ? "L" : "D";

            const hasStats = isCompleted && !!(match.statistics?.home && match.statistics?.away);

            const statsH = match.statistics?.home ?? {};
            const statsA = match.statistics?.away ?? {};
            const pre = match.context?.preMatch ?? {};

            const pe = hasStats
                ? computePerfExec(match, {
                    homeRank: pre.homePosition,
                    awayRank: pre.awayPosition,
                    homeForm: pre.homeForm,
                    awayForm: pre.awayForm,

                    homeCards: { yc: statsH.ycMinutes ?? [], rc: statsH.rcMinutes ?? [] },
                    awayCards: { yc: statsA.ycMinutes ?? [], rc: statsA.rcMinutes ?? [] },

                    homeDisallowedGoals: statsH.disallowedGoals ?? 0,
                    awayDisallowedGoals: statsA.disallowedGoals ?? 0,

                    homeOwnGoalsFor: statsH.ownGoalsFor ?? 0,
                    awayOwnGoalsFor: statsA.ownGoalsFor ?? 0,
                })
                : null;

            out[homeSlug].matches.push({
                mw,
                fixtureId: match.id, 
                href: getMatchPagePath({
                    seasonPath: season.seasonPath,
                    round: mw,
                    homeTeamId: homeSlug,
                    awayTeamId: awaySlug,
                }),
                kickoff: match.kickoff,
                opponent: awaySlug,
                opponentName: teamsBySlug[awaySlug]?.name ?? awaySlug,
                homeAway: "H",
                score: isCompleted ? `${homeGoals}–${awayGoals}` : "–",
                state,
                result: homeResult,
                mx: pe ? pe.homePerf : null,
                ex: pe ? pe.homeExec : null,
                rating: pe ? pe.homePower : null
            });

            out[awaySlug].matches.push({
                mw,
                fixtureId: match.id, 
                href: getMatchPagePath({
                    seasonPath: season.seasonPath,
                    round: mw,
                    homeTeamId: homeSlug,
                    awayTeamId: awaySlug,
                }),
                kickoff: match.kickoff,
                opponent: homeSlug,
                opponentName: teamsBySlug[homeSlug]?.name ?? homeSlug,
                homeAway: "A",
                score: isCompleted ? `${awayGoals}–${homeGoals}` : "–",
                state,
                result: awayResult,
                mx: pe ? pe.awayPerf : null,
                ex: pe ? pe.awayExec : null,
                rating: pe ? pe.awayPower : null
            });
        }
    }

    for (const slug of Object.keys(out)) {

        const matches = out[slug].matches.sort((a, b) => {
            const aTime = Date.parse(a.kickoff || "");
            const bTime = Date.parse(b.kickoff || "");

            if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
                return aTime - bTime;
            }

            return a.mw - b.mw;
        });

        let wins = 0;
        let draws = 0;
        let losses = 0;
        let gf = 0;
        let ga = 0;

        const mxVals = [];
        const exVals = [];
        const ratingVals = [];

        const completedMatches = matches.filter((m) => m.result === "W" || m.result === "D" || m.result === "L");

        for (const m of completedMatches) {
            if (m.result === "W") wins += 1;
            else if (m.result === "D") draws += 1;
            else if (m.result === "L") losses += 1;

            const [forGoals, againstGoals] = String(m.score)
                .split("–")
                .map((n) => Number(n));

            gf += Number.isFinite(forGoals) ? forGoals : 0;
            ga += Number.isFinite(againstGoals) ? againstGoals : 0;

            if (typeof m.mx === "number") mxVals.push(m.mx);
            if (typeof m.ex === "number") exVals.push(m.ex);
            if (typeof m.rating === "number") ratingVals.push(m.rating);
        }

        out[slug].summary = {
            played: completedMatches.length,
            wins,
            draws,
            losses,
            gf,
            ga,
            gd: gf - ga,
            points: wins * 3 + draws,
            avgMx: averageOrNull(mxVals),
            avgEx: averageOrNull(exVals),
            avgRating: averageOrNull(ratingVals),
            last5: completedMatches.slice(-5).map((m) => m.result),

            // TEMP DEBUG
            mxVals,
            exVals,
            ratingVals
        };
    }

    return out;
}

async function main() {

    const template = await fs.readFile(DIST_INDEX, "utf8");

    const seasonStart = season.apiSeason;
    const seasonPath = season.seasonPath;
    const seasonLabel = season.displaySeasonLabel;
    const maxRound = season.maxRound;
    const SITE_NAME = "Timeline";
    const OG_DEFAULT_IMAGE = "https://timelinefootball.com/og/og-default.png";
    const teams = await readJsonIfExists(
        path.join(ROOT, "src", "data", "leagues", season.leagueKey, season.sourceDataSeason, "teams.json"),
        {}
    );
    const players = await readJsonIfExists(
        path.join(ROOT, "src", "data", "leagues", season.leagueKey, season.sourceDataSeason, "players.json"),
        {}
    );
    const oddsJson = await loadOddsForPrerender();
    const oddsByFixture = oddsJson?.fixtures ?? {};
    await writeDistOdds(oddsJson);

    const rounds = await listMatchdayRounds();
    if (!rounds.length) {
        console.log("No matchday JSON files found to prerender.");
        return;
    }

    for (const round of rounds) {
        const mdPath = path.join(MATCHDAYS_DIR, `${round}.json`);
        const md = JSON.parse(await fs.readFile(mdPath, "utf8"));
        const matches = attachMatchData(md.matches || [], oddsByFixture, round, seasonPath);

        const appHtml = renderMatchweekHTML({
            matches,
            teams,
            players,
            seasonPath,
            globalMode: "compact",
        });

        const pagePath = `/epl/${seasonPath}/matchweek/${round}/`;

        // NOTE: We'll swap this to your live domain in the SEO step.
        const canonical = `https://timelinefootball.com${pagePath}`;

        const title = `${season.leagueShortName} ${seasonLabel} Matchweek ${round} Timelines, Stats & Ratings`;
        const desc = ` ${season.leagueName} ${seasonLabel} Matchweek ${round} event timelines, odds, stats and performance ratings.`;

        let out = setSeasonChrome(template, {
            seasonPath,
            seasonLabel,
            leagueName: season.leagueName,
        });
        out = setTitle(
            out,
            title
        );
        out = setDescription(
            out,
            desc
        );
        out = setCanonical(out, canonical);

        const ogTitle = title;
        const ogDesc = desc;

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
            season: seasonStart,
            seasonLabel,
            round,
            matches,
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

        for (const match of matches) {
            const home = teams[match.homeTeamId];
            const away = teams[match.awayTeamId];
            const matchPath = match.matchPagePath;

            if (!home || !away || !matchPath) continue;

            const matchCanonical = `https://timelinefootball.com${matchPath}`;
            const scoreTitle = formatScoreForTitle(match);
            const title = `${home.name} ${scoreTitle} ${away.name} | EPL ${seasonLabel} Matchweek ${round}`;
            const desc = buildMatchStory({ match, home, away, seasonLabel, round });

            let matchPage = setSeasonChrome(template, {
                seasonPath,
                seasonLabel,
                leagueName: season.leagueName,
            });

            matchPage = setTitle(matchPage, title);
            matchPage = setDescription(matchPage, desc);
            matchPage = setCanonical(matchPage, matchCanonical);
            matchPage = setOpenGraph(matchPage, {
                title,
                description: desc,
                url: matchCanonical,
                image: OG_DEFAULT_IMAGE,
                siteName: SITE_NAME,
            });
            matchPage = setTwitterCard(matchPage, {
                title,
                description: desc,
                image: OG_DEFAULT_IMAGE,
            });

            const navHtml = `<nav class="mw-nav" aria-label="EPL navigation">
                <a class="mw-nav__hub" href="/epl/${seasonPath}/">EPL ${seasonLabel} matchweeks &#9655;</a>
                <div class="mw-nav__pager">
                    <a class="mw-nav__prev" href="/epl/${seasonPath}/matchweek/${round}/">Matchweek ${round} &#9655;</a>
                    <a class="mw-nav__next" href="/epl/${seasonPath}/table/">League table &#9655;</a>
                </div>
            </nav>`;

            matchPage = injectBeforeApp(matchPage, navHtml);
            matchPage = injectApp(matchPage, buildMatchPageHtml({
                match,
                home,
                away,
                players,
                seasonPath,
                seasonLabel,
                round,
            }));
            matchPage = setJsonLd(matchPage, matchPageJsonLd({ match, home, away, pageUrl: matchCanonical }));
            matchPage = stripAppScripts(matchPage);
            matchPage = stripMatchdayShell(matchPage);

            const matchOutDir = path.join(ROOT, "dist", matchPath.replace(/^\/+|\/+$/g, ""));
            await fs.mkdir(matchOutDir, { recursive: true });
            await fs.writeFile(path.join(matchOutDir, "index.html"), matchPage, "utf8");

            console.log(`Prerendered ${matchPath}`);
        }
    }

    const hubPath = `/epl/${seasonPath}/`;
    const canonical = `https://timelinefootball.com${hubPath}`;

    let out = setSeasonChrome(template, {
        seasonPath,
        seasonLabel,
        leagueName: season.leagueName,
    });

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
    const rawStandingsRows = getStandingsRows(standingsJson);
    const apiIdToSlug = buildApiTeamIdToSlugMap(teams);
    const standingsRows = sortStandingsRowsForDisplay(rawStandingsRows, teams, apiIdToSlug);

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

    const teamSeasonBySlug = buildTeamSeason({
        roundsData,
        teamsBySlug: teams
    });
    const leaguePerformanceBySlug = buildLeaguePerformance({
        roundsData,
        teamsBySlug: teams
    });

    // standings lookup
    const standingsByApiId = new Map(standingsRows.map(r => [r.teamApiId, r]));

    // ---- Table page ----
    {
        const pagePath = `/epl/${seasonPath}/table/`;
        const canonical = `https://timelinefootball.com${pagePath}`;

        let page = setSeasonChrome(template, {
            seasonPath,
            seasonLabel,
            leagueName: season.leagueName,
        });

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

        let page = setSeasonChrome(template, {
            seasonPath,
            seasonLabel,
            leagueName: season.leagueName,
        });

        const standingsRow = standingsByApiId.get(team.apiTeamId) || null;

        const title = `${team.name} EPL ${seasonLabel} | Results & Match Timelines`;
        const desc = `${team.name} EPL ${seasonLabel} season page: current league status, ratings, results, season trends and matchweek timeline links.`;

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
            teamSeason: teamSeasonBySlug[slug] || null,
            leaguePerformance: leaguePerformanceBySlug[slug] || null,
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

    console.log(`Prerendered /epl/${seasonPath}/`);

}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
