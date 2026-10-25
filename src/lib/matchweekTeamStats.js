import { getMatchPagePath } from "./matchUrls.js";
import { computePerfExec } from "./powerMeter.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function numberOrNull(value) {
  if (value == null || value === "") return null;
  const parsed = Number(String(value).replace("%", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function formatInteger(value) {
  return Number.isFinite(value) ? String(Math.round(value)) : "-";
}

function formatSignedExecution(value) {
  if (!Number.isFinite(value)) return "-";
  const delta = Math.round(value - 50);
  return delta > 0 ? `+${delta}` : String(delta);
}

function formatXg(value) {
  return Number.isFinite(value) ? value.toFixed(2) : "-";
}

function formatPossession(value) {
  return Number.isFinite(value) ? `${Math.round(value)}%` : "-";
}

function resultFor(goalsFor, goalsAgainst) {
  if (goalsFor > goalsAgainst) return { label: "W", className: "is-win" };
  if (goalsFor < goalsAgainst) return { label: "L", className: "is-loss" };
  return { label: "D", className: "is-draw" };
}

function performanceContext(match) {
  const statsH = match.statistics?.home ?? {};
  const statsA = match.statistics?.away ?? {};
  const pre = match.context?.preMatch ?? {};

  return {
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
  };
}

function buildRows(matches, teams, seasonPath, round) {
  const rows = [];

  for (const match of matches) {
    if (String(match.status?.state ?? "").toUpperCase() !== "FT") continue;

    const home = teams[match.homeTeamId];
    const away = teams[match.awayTeamId];
    if (!home || !away) continue;

    const homeGoals = numberOrNull(match.score?.home) ?? 0;
    const awayGoals = numberOrNull(match.score?.away) ?? 0;
    const performance = computePerfExec(match, performanceContext(match));
    const matchHref = match.matchPagePath ?? getMatchPagePath({
      seasonPath,
      round: match.round ?? round,
      homeTeamId: match.homeTeamId,
      awayTeamId: match.awayTeamId,
    });

    const sides = [
      {
        teamId: match.homeTeamId,
        team: home,
        opponentId: match.awayTeamId,
        opponent: away,
        stats: match.statistics?.home ?? {},
        goalsFor: homeGoals,
        goalsAgainst: awayGoals,
        px: performance?.homePerf,
        ex: performance?.homeExec,
        rating: performance?.homePower,
      },
      {
        teamId: match.awayTeamId,
        team: away,
        opponentId: match.homeTeamId,
        opponent: home,
        stats: match.statistics?.away ?? {},
        goalsFor: awayGoals,
        goalsAgainst: homeGoals,
        px: performance?.awayPerf,
        ex: performance?.awayExec,
        rating: performance?.awayPower,
      },
    ];

    for (const side of sides) {
      rows.push({
        ...side,
        matchHref,
        result: resultFor(side.goalsFor, side.goalsAgainst),
        xg: numberOrNull(side.stats.xg),
        possession: numberOrNull(side.stats.poss),
        shots: numberOrNull(side.stats.shots),
      });
    }
  }

  rows.sort((a, b) => {
    const ratingA = Number.isFinite(a.rating) ? a.rating : -1;
    const ratingB = Number.isFinite(b.rating) ? b.rating : -1;
    const pxA = Number.isFinite(a.px) ? a.px : -1;
    const pxB = Number.isFinite(b.px) ? b.px : -1;
    return ratingB - ratingA || pxB - pxA || a.team.name.localeCompare(b.team.name);
  });

  let previousRating = null;
  let previousRank = 0;
  return rows.map((row, index) => {
    const isTie = Number.isFinite(row.rating) && row.rating === previousRating;
    const rank = isTie ? previousRank : index + 1;
    previousRating = row.rating;
    previousRank = rank;
    return { ...row, rank };
  });
}

export function buildMatchweekTeamStatsHtml({
  matches = [],
  teams = {},
  seasonPath,
  round,
  competitionName = "Premier League",
}) {
  const rows = buildRows(matches, teams, seasonPath, round);
  const completedMatches = matches.filter(
    (match) => String(match.status?.state ?? "").toUpperCase() === "FT"
  ).length;
  const totalMatches = matches.length;
  const statusText = `${completedMatches} of ${totalMatches} matches complete.`;

  const body = rows.length
    ? `
      <div class="matchweek-team-stats__table-wrap" tabindex="0">
        <table class="matchweek-team-stats__table">
          <caption class="visually-hidden">${escapeHtml(competitionName)} Matchweek ${escapeHtml(round)} team performance statistics</caption>
          <thead>
            <tr>
              <th scope="col" class="mw-team-stat-rank">#</th>
              <th scope="col" class="mw-team-stat-team">Team</th>
              <th scope="col" class="mw-team-stat-opponent">Opponent</th>
              <th scope="col">Result</th>
              <th scope="col"><abbr title="Performance Index">pX</abbr></th>
              <th scope="col"><abbr title="Execution Index versus the 50 baseline">eX</abbr></th>
              <th scope="col">Rating</th>
              <th scope="col"><abbr title="Expected goals">xG</abbr></th>
              <th scope="col">Possession</th>
              <th scope="col">Shots</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => {
              const teamName = row.team.display || row.team.name;
              const opponentName = row.opponent.display || row.opponent.name;
              const score = `${row.goalsFor}-${row.goalsAgainst}`;
              return `
                <tr>
                  <td class="mw-team-stat-rank">${row.rank}</td>
                  <th scope="row" class="mw-team-stat-team">
                    <a href="/epl/${escapeHtml(seasonPath)}/team/${escapeHtml(row.teamId)}/">
                      <img src="${escapeHtml(row.team.badge)}" alt="" aria-hidden="true" width="28" height="28" loading="lazy">
                      <span>${escapeHtml(teamName)}</span>
                    </a>
                  </th>
                  <td class="mw-team-stat-opponent">
                    <a href="/epl/${escapeHtml(seasonPath)}/team/${escapeHtml(row.opponentId)}/">${escapeHtml(opponentName)}</a>
                  </td>
                  <td>
                    <a class="mw-team-stat-result ${row.result.className}" href="${escapeHtml(row.matchHref)}" aria-label="${escapeHtml(row.result.label)} ${escapeHtml(score)} against ${escapeHtml(opponentName)}">
                      <span>${row.result.label}</span> ${escapeHtml(score)}
                    </a>
                  </td>
                  <td>${formatInteger(row.px)}</td>
                  <td>${formatSignedExecution(row.ex)}</td>
                  <td class="mw-team-stat-rating">${formatInteger(row.rating)}</td>
                  <td>${formatXg(row.xg)}</td>
                  <td>${formatPossession(row.possession)}</td>
                  <td>${formatInteger(row.shots)}</td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    `
    : `<p class="matchweek-team-stats__empty">Team rankings will appear after the first match is complete and full statistics are available.</p>`;

  return `
    <section class="matchweek-team-stats" data-matchweek-team-stats aria-labelledby="matchweek-team-stats-title">
      <div class="matchweek-team-stats__heading">
        <h2 id="matchweek-team-stats-title">${escapeHtml(competitionName)} Matchweek ${escapeHtml(round)} Team Ratings</h2>
        <p>Compare each team&rsquo;s match performance, execution, rating and core statistics at a glance.</p>
        <p class="matchweek-team-stats__status"><strong>${escapeHtml(statusText)}</strong> Teams are ranked by Rating.</p>
      </div>
      ${body}
    </section>
  `.trim();
}
