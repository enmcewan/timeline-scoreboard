import { computePerfExec } from "./powerMeter.js";
import { getMatchPagePath } from "./matchUrls.js";

export const VIEW_MODES = {
    COMPACT: "compact",
    FULL: "full",
};

const BALL_ICON_PATH = "M61.934 31.992c.021-.713.209-10.904-5.822-17.538c-.268-.593-1.539-2.983-5.641-5.904a41.959 41.959 0 0 0-5.775-3.763l-.008-.004C44.432 4.646 39.43 2 33.359 2c-.461 0-.917.027-1.368.058V2.05c-4.629-.101-9.227 1.09-11.998 2.341c-2.458 1.11-5.187 2.971-5.384 3.115C11.205 9.41 4.75 17.051 4.239 21.1c-2.063 2.637-3.787 14.482.004 21.697c2.658 10.027 12.664 15.045 13.46 15.43c.484.309 5.937 3.68 12.636 3.68c.281 0 1.98.094 2.586.094c7.241 0 17.971-5.104 20.217-9.102c6.171-4.514 9.37-16.147 8.792-20.907M17.758 47.055c-2.869-4.641-4.504-10.705-4.854-12.098c.908-1.361 5.387-7.965 7.939-9.952c1.445.266 7.479 1.374 13.17 2.404c.715 1.853 3.852 10.029 4.75 13.185c-.99 1.174-4.879 5.702-8.708 9.248c-4.065.019-10.979-2.326-12.297-2.787M53.824 14.58c-.012.45-.119 2.05-.885 3.887c-1.521-.777-5.344-2.441-10.584-2.722c-.793-1.171-3.777-5.254-8.49-8.086c.645-1.262 1.543-2.801 2.068-3.27c.17-.048.434-.092.836-.092c2.527 0 6.893 1.655 7.273 1.802c.403.213 8.251 4.439 9.782 8.481M11.773 34.012c-3.423-.584-5.458-1.648-6.066-2.008c-1.273-4.617-.248-9.607-.09-10.322c1.256-2.246 4.832-7.971 7.191-9.058c2.445-.499 5.494.121 6.736.424c-.117 1.615-.342 6.127.326 10.862c-2.706 2.178-6.989 8.447-8.097 10.102M31.685 3.53c.768.057 1.895.225 2.667.454c-.77 1.024-1.559 2.542-1.932 3.292c-1.57.257-7.533 1.397-12.211 4.43c-.943-.25-3.791-.917-6.488-.687c.668-1.293 1.666-2.249 1.773-2.347c.371-.266 7.513-5.263 16.191-5.155v.013m19.096 38.093c-1.17-.048-5.678-.305-10.621-1.466c-.947-3.302-4.074-11.444-4.789-13.296a556.586 556.586 0 0 1 6.928-9.654c5.688.312 9.682 2.387 10.455 2.82c3.295 5.299 4.018 10.711 4.117 11.615c-1.75 5.446-5.211 9.113-6.09 9.981M3.655 28.519c.084 1.266.287 2.599.654 3.917a11.738 11.738 0 0 0-.682 2.651a33.039 33.039 0 0 1 .028-6.568m9.644 23.359c1.508-1.453 3.367-2.867 4.088-3.401c1.63.574 8.324 2.837 12.591 2.837c.727.975 3.104 4.028 6.018 6.362c-1.814 1.775-4.434 2.613-4.897 2.752c-8.127.218-16.042-4.35-17.8-8.55m21.463 8.538c.922-.537 1.883-1.244 2.678-2.139c1.297-.179 6.863-1.137 11.893-4.832c.332.036.879.08 1.49.063c-3.018 2.957-10.382 6.26-16.061 6.908m15.424-8.376c1.807-4.708 1.73-8.258 1.641-9.392c.992-.972 4.396-4.599 6.285-10.113c1.018.17 1.68.429 1.994.574c.109.4.291 1.324.188 2.725c-.77 5.043-3.428 12.6-8.084 15.941c-.468.239-1.292.291-2.024.265";

function renderBallIconSvg(size = 16) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true"><path d="${BALL_ICON_PATH}"></path></svg>`;
}

function renderSubIconSvg() {
    return `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M11.534 7h3.932a.25.25 0 0 1 .192.41l-1.966 2.36a.25.25 0 0 1-.384 0l-1.966-2.36a.25.25 0 0 1 .192-.41m-11 2h3.932a.25.25 0 0 0 .192-.41L2.692 6.23a.25.25 0 0 0-.384 0L.342 8.59A.25.25 0 0 0 .534 9"></path><path fill-rule="evenodd" d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 1 1-.771-.636A6.002 6.002 0 0 1 13.917 7H12.9A5 5 0 0 0 8 3M3.1 9a5.002 5.002 0 0 0 8.757 2.182.5.5 0 1 1 .771.636A6.002 6.002 0 0 1 2.083 9z"></path></svg>`;
}

function formatPlayerName(fullName = "") {
    const trimmedName = String(fullName).trim();

    // Already "F. Last"
    if (/^[A-Z]\.\s/.test(trimmedName)) return trimmedName;

    const parts = trimmedName.split(/\s+/).filter(Boolean);
    if (parts.length <= 1) return parts[0] ?? "";

    const [first, ...rest] = parts;
    const initial = first.charAt(0).toUpperCase();
    const lastName = rest.join(" ");
    return `${initial}. ${lastName}`;
}

function getPlayerTitle(playersById, playerId, fallbackName) {
    if (!playerId) return fallbackName || "";
    const p = playersById?.[String(playerId)];
    return p?.fullName || p?.name || fallbackName || "";
}

export function isVisibleInMode(evt, mode) {
    if (mode === VIEW_MODES.FULL) return true;

    switch (evt.kind) {
        case "goal":
        case "red":
        case "own-goal":
        case "var-goal-cancelled":
        case "var-goal-disallowed-offside":
        case "var-goal-disallowed":
            return true;
        default:
            return false;
    }
}

export function createRenderEventText(esc, playersById = {}) {

    return function renderEventText(evt, mode) {

        const player = formatPlayerName(esc(evt.player ?? ""));
        const playerIn = formatPlayerName(esc(evt.inPlayer ?? ""));
        const playerOut = formatPlayerName(esc(evt.outPlayer ?? ""));
        const playerTitle = getPlayerTitle(playersById, evt.playerId, evt.player);
        const assistTitle = getPlayerTitle(playersById, evt.assistId, evt.assist);

        const card = evt.kind === "red" || evt.kind === "yellow";

        if (card) {
            const isRed = evt.kind === "red";
            const isSecondYellow = isRed && evt.secondYellow === true;
            const color = isRed ? "red" : "yellow";

            let cardTitle = "Yellow card";
            if (isRed) {
                cardTitle = isSecondYellow ? "Red card (2nd yellow)" : "Straight Red card";
            }

            let reason = esc(evt.comments) || "other";
            if (reason === "Professional foul last man") reason = "Pro-foul: last man";
            if (reason === "Unsportsmanlike conduct") reason = "Unsportsmanlike";
            if (!reason || reason === "null" || reason === "undefined") reason = "other";
            const meta = ` <span class="event-meta foul">(${reason})</span>`;

            const secondYellowIcon = isSecondYellow
                ? `<span class="card yellow second-yellow" title="Second yellow card" aria-label="Second yellow card" role="img"></span>`
                : "";

            const mainCardIcon = `<span class="card ${color}" title="${cardTitle}" aria-label="${cardTitle}" role="img"></span>`;

            return `
                    <span class="player player-${color}" title="${esc(playerTitle)}">${player}</span>
                    ${secondYellowIcon}
                    ${mainCardIcon}
                    ${meta}
                `;
        }

        // goal
        if (evt.kind === "goal" || evt.kind === "own-goal") {
            const isOG = evt.kind === "own-goal";

            // 1. Build the Goal Icon
            const iconClass = isOG ? "og-goal-ball" : "goal-ball";
            const iconTitle = isOG ? "Own Goal" : "Goal";
            const goalImg = `
                            <span class="evt-svg ${iconClass}" title="${iconTitle}" aria-label="${iconTitle}" role="img">
                                ${renderBallIconSvg(18)}
                            </span>
                        `;

            // 2. Collect Metadata (The Clean Way)
            const metaParts = [];

            if (evt.assist) {
                metaParts.push(`<span class="assist" title="${esc(assistTitle)}">(${formatPlayerName(esc(evt.assist))})</span>`);
            }

            if (evt.detail === "pen") {
                metaParts.push(`<span class="goal-detail">(Pen)</span>`);
            }

            if (isOG) {
                metaParts.push(`<span class="own-goal-label" title="Own Goal">(Own Goal)</span>`);
            }

            // 3. Assemble
            const playerLabel = `<span class="player-goal" title="${esc(playerTitle)}">${player}</span>`;
            const metaHtml = metaParts.length > 0
                ? ` <span class="event-meta">${metaParts.join(" ")}</span>`
                : "";

            return `${playerLabel}${goalImg}${metaHtml}`;
        }

        /* NEW: missed penalty */
        if (evt.kind === "penalty-miss") {

            let missImg = "";
            if (mode === VIEW_MODES.FULL) {
                missImg = `
                    <span class="evt-svg missed-pen-ball" title="Missed penalty" aria-label="Missed penalty" role="img">
                        ${renderBallIconSvg()}
                    </span>
                `;
            }

            return `
                <span class="player" title="${esc(playerTitle)}">${player}</span>
                ${missImg}
                <span class="missed-pen-label">(missed pen)</span>
            `;
        }

        if (evt.kind.startsWith("var-goal-")) {

            // 1. Define the configurations in one place
            const GOAL_VAR_MAP = {
                "var-goal-cancelled": { css: "var-no-goal", label: "Overturned", isDisallowed: true },
                "var-goal-disallowed-offside": { css: "var-no-goal", label: "Offside", isDisallowed: true },
                "var-goal-disallowed": { css: "var-no-goal", label: "Disallowed", isDisallowed: true },
                "var-goal-confirmed": { css: "var-goal-confirmed", label: "Confirmed", isDisallowed: false }
            };

            const config = GOAL_VAR_MAP[evt.kind];

            if (config) {
                // 2. Handle the Icon logic
                const showIcon = config.isDisallowed;
                const varIcon = showIcon ? `
                    <span class="evt-svg var-goal-cancelled-icon" title="Disallowed (VAR)" aria-label="Goal Disallowed (VAR)" role="img">
                        ${renderBallIconSvg()}
                    </span>
                ` : "";

                // 3. Build the Meta tag
                const meta = ` <span class="event-meta">
                                    <span class="var ${config.css}"><span class="var-event">VAR</span> (${config.label})</span>
                                </span>
                            `;

                // 4. Return based on whether it was disallowed or confirmed
                if (config.isDisallowed) {
                    return `
                                <span class="player var-player" title="${esc(playerTitle)}">${player}</span>
                                ${varIcon}
                                ${meta}
                            `;
                }

                return meta;
            }

        }

        if (evt.kind === "var-pen-cancelled" || evt.kind === "var-pen-confirmed" || evt.kind === "var-card-upgrade") {

            const varConfigs = {
                "var-pen-cancelled": { css: "var-no-goal", label: "Pen Overturned" },
                "var-pen-confirmed": { css: "var-pen-awarded", label: "Pen Awarded" },
                "var-card-upgrade": { css: "var-card-upgrade", label: "Card Upgraded" }
            };

            const config = varConfigs[evt.kind];

            if (config) {
                const meta = `
                    <span class="var ${config.css}">
                        <span class="var-event">VAR</span> (${config.label})
                    </span>`;

                return `
                    <span class="player var-player" title="${esc(playerTitle)}">${player}</span>
                    <span class="event-meta">${meta}</span>
                `;
            }
        }

        // Substitution
        if (evt.kind === "sub") {

            return `
                <span class="player subbed" title="${esc(playerTitle)}">${playerOut}</span>
                <span class="evt-svg sub-arrow" aria-hidden="true" title="Substitution">
                    ${renderSubIconSvg()}
                </span>
                <span class="event-meta">
                    <span class="sub" title="${esc(assistTitle)}">${playerIn}</span>
                </span>
            `;
        }

    }

}

export function createRenderEventRow(esc, renderEventText) {

    return function renderEventRow(evt, mode) {
        const minute = esc(evt.minute);
        const isResultEvent = isVisibleInMode(evt, VIEW_MODES.COMPACT);

        const homeCell = evt.team === "home" ? renderEventText(evt, mode) : "";
        const awayCell = evt.team === "away" ? renderEventText(evt, mode) : "";

        if (evt.kind !== "var" && evt.detail !== "penalty confirmed") {

            return `
                <div class="row" data-result-event="${isResultEvent ? "true" : "false"}">
                <div class="event home">${homeCell}</div>
                <div class="minute">${minute}</div>
                <div class="event away">${awayCell}</div>
                </div>
            `;
        }
    }

}

export function createRenderMatchCard({
    esc,
    teamsById,
    seasonPath,
    sortedEvents,
    isVisibleInMode,
    renderEventRow,       // function (evt, mode) => html
    getModeForMatchId,    // function (matchId) => mode string
    formatKickoff         // optional: (isoString) => string
}) {
    const fmtKick =
        formatKickoff ??
        ((iso) =>
            iso
                ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
                : "TBD");

    function isHalfTimeOrLater(state) {
        const s = String(state || "").toUpperCase().trim();

        if (s === "HT" || s === "FT") return true;

        const minute = parseInt(s, 10);
        return Number.isFinite(minute) && minute >= 45;
    }

    function renderPreMatchOdds(match, home, away) {
        const consensus = match.odds?.consensus;
        if (!consensus) return "";

        const homePct = Number(consensus.home);
        const drawPct = Number(consensus.draw);
        const awayPct = Number(consensus.away);

        if (![homePct, drawPct, awayPct].every(Number.isFinite)) return "";

        const sourceCount = Number(match.odds?.sourceCount ?? 0);
        const sourceLabel = sourceCount > 0
            ? ` from ${sourceCount} bookmaker${sourceCount === 1 ? "" : "s"}`
            : "";
        const title = `Pre-match consensus expectation${sourceLabel}`;

        return `
                <fieldset class="match-odds" title="${esc(title)}" aria-label="${esc(title)}">
                    <legend>Pre-match odds</legend>
                    <div class="match-odds__grid">
                        <div class="match-odds__cell match-odds__cell--home" aria-label="${esc(home.display || home.name)} ${homePct}%">
                            <strong>${homePct}%</strong>
                        </div>
                        <div class="match-odds__cell match-odds__cell--draw" aria-label="Draw ${drawPct}%">
                            <strong>${drawPct}%</strong>
                        </div>
                        <div class="match-odds__cell match-odds__cell--away" aria-label="${esc(away.display || away.name)} ${awayPct}%">
                            <strong>${awayPct}%</strong>
                        </div>
                    </div>
                </fieldset>
        `;
    }

    return function renderMatchCard(match) {

        const home = teamsById[match.homeTeamId];
        const away = teamsById[match.awayTeamId];

        if (!home || !away) {
            throw new Error(`Unknown team id(s): ${match.homeTeamId}, ${match.awayTeamId}`);
        }

        const state = String(match.status?.state || "").toUpperCase();
        const hasStats = !!(match.statistics?.home && match.statistics?.away);

        const statsH = match.statistics?.home ?? {};
        const statsA = match.statistics?.away ?? {};

        const pre = match.context?.preMatch ?? {};
        // console.log("PREMATCH", match.id, pre);

        // console.log("MATCH CONTEXT", match.id, match.context);

        const pe = ((isHalfTimeOrLater(state)) && hasStats)
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

            }) : null;

        // console.log("PE RESULT", {
        //     matchId: match.id,
        //     state,
        //     hasStats,
        //     pe
        // });

        const mode = getModeForMatchId(String(match.id));

        const gameStatus = esc(match.status?.state ?? "");

        let halfTimeScore = "";
        let gameMinute = parseInt(gameStatus, 10);
        if (Number.isNaN(gameMinute)) gameMinute = 0;

        if (gameMinute > 45 || gameStatus === "FT") {
            halfTimeScore = `(HT ${esc(match.status?.halfTimeScore ?? "")})`;
        }

        const allEvents = sortedEvents(match.events || []);
        const eventsHtml = allEvents
            .filter((evt) => isVisibleInMode(evt, mode))
            .map((evt) => renderEventRow(evt, mode))
            .join("");

        const kickoffTime = fmtKick(match.kickoff);

        const homeHref = `/epl/${seasonPath}/team/${match.homeTeamId}/`;
        const awayHref = `/epl/${seasonPath}/team/${match.awayTeamId}/`;
        const matchHref = match.matchPagePath ?? getMatchPagePath({
            seasonPath,
            round: match.round,
            homeTeamId: match.homeTeamId,
            awayTeamId: match.awayTeamId,
        });

        const stat = (side, key, fallback = " - ") =>
            match.statistics?.[side]?.[key] ?? fallback;

        const statNum = (side, key, fallback = " - ") => {
            const v = match.statistics?.[side]?.[key];
            return (v === 0 || (typeof v === "number" && Number.isFinite(v))) ? v : fallback;
        };

        // +/- from 50 for execution index

        const homeEx = pe ? pe.homeExec : null;
        const awayEx = pe ? pe.awayExec : null;

        const exDelta = (v) => (v == null ? null : Math.round(v - 50));

        const homeExDelta = exDelta(homeEx);
        const awayExDelta = exDelta(awayEx);

        const exNegWidth = (v) => {
            if (v == null || v >= 50) return 0;
            return Math.round(((50 - v) / 50) * 100);
        };

        const exPosWidth = (v) => {
            if (v == null || v <= 50) return 0;
            return Math.round(((v - 50) / 50) * 100);
        };

        const fmtDelta = (d) => {
            if (d == null) return "-";
            if (d > 0) return `+${d}`;
            return `${d}`;
        };

        let homeScore;
        let awayScore;

        if (match.status.state === 'NS') {

            homeScore = '-';
            awayScore = '-';
        } else {

            homeScore = esc(match.score.home);
            awayScore = esc(match.score.away);
        }

        return `
            <article id="fixture-${match.id}" class="match-card" data-match-id="${match.id}">
                <div class="match-date">${esc(kickoffTime)}</div>

                <header class="match-header">
                    <div class="ht-cont">
                        <a href="${esc(homeHref)}" class="team-link">
                        <div class="team-badge-cont" title="${esc(home.nicknames[0] || "")}">
                            <img class="team-badge ${match.homeTeamId}" src="${esc(home.badge)}" alt="${esc(home.name)} badge" />
                        </div>
                        <div class="team home" title="Team Page">${esc(home.display || home.name)}</div>
                        </a>
                    </div>

                    <div class="score-container">
                        <div class="score">
                            <div class="score-home">${homeScore}</div>
                            <span class="separator" aria-hidden="true"></span>
                            <div class="score-away">${awayScore}</div>
                        </div>
                        <div class="match-status">
                            <span class="half-time">${gameStatus} ${halfTimeScore}</span>
                        </div>
                    </div>

                    <div class="at-cont">
                        <a href="${esc(awayHref)}" class="team-link">
                        <div class="team-badge-cont" title="${esc(away.nicknames[0] || "")}">
                            <img class="team-badge ${match.awayTeamId}" src="${esc(away.badge)}" alt="${esc(away.name)} badge" />
                        </div>
                        <div class="team away" title="Team Page">${esc(away.display || away.name)}</div>
                        </a>
                    </div>
                </header>

                ${renderPreMatchOdds(match, home, away)}

                <section id="stats" class="power-meter" aria-label="Match power meter">
                    <fieldset class="match-card-group">
                        <legend>Performance</legend>
                        <div class="match-card-group__grid">
                    <!-- HOME -->
                    <div class="pm-team pm-team--home">
                        <div class="pm-team__label">${esc(home.display || home.name)}</div>

                        <div class="pm-grid">
                            <!-- Perf row -->
                            <div class="pm-row">
                                <div class="pm-row__name" title="Performance Index">pX</div>
                                <div class="pm-bar" role="img" aria-label="Performance ${pe ? pe.homePerf : "—"} out of 100">
                                    <div class="pm-bar__fill" style="width: ${pe ? pe.homePerf : 0}%;"></div>
                                </div>
                                <div class="pm-row__val">${pe ? pe.homePerf : " - "}</div>
                            </div>
                            <!-- Exec row -->
                            <div class="pm-row">
                                <div class="pm-row__name" title="Execution Index">eX</div>
                                <div class="pm-exbar" role="img" aria-label="Execution ${homeEx ?? "not available"}">
                                    <div class="pm-exbar__half pm-exbar__half--neg">
                                    <div class="pm-exbar__fill pm-exbar__fill--neg" style="width: ${exNegWidth(homeEx)}%;"></div>
                                    </div>
                                    <div class="pm-exbar__mid">|</div>
                                    <div class="pm-exbar__half pm-exbar__half--pos">
                                    <div class="pm-exbar__fill pm-exbar__fill--pos" style="width: ${exPosWidth(homeEx)}%;"></div>
                                    </div>
                                </div>
                                <div class="pm-row__val">${fmtDelta(homeExDelta)}</div>
                            </div>
                            <!-- Power (spans both rows) -->
                            <div class="pm-power" aria-label="Power rating">
                                <div class="pm-power__num">${pe ? pe.homePower : " - "}</div>
                                <div class="pm-power__label">Rating</div>
                            </div>

                        </div>
                    </div>

                    <!-- AWAY -->
                    <div class="pm-team pm-team--away">
                        <div class="pm-team__label">${esc(away.display || away.name)}</div>

                        <div class="pm-grid">
                            <!-- Perf row -->
                            <div class="pm-row">
                                <div class="pm-row__name" title="Performance Index">pX</div>
                                <div class="pm-bar" role="img" aria-label="Performance ${pe ? pe.awayPerf : "—"} out of 100">
                                    <div class="pm-bar__fill" style="width: ${pe ? pe.awayPerf : 0}%;"></div>
                                </div>
                                <div class="pm-row__val">${pe ? pe.awayPerf : " - "}</div>
                            </div>
                            <!-- Exec row -->
                            <div class="pm-row">
                                <div class="pm-row__name" title="Execution">eX</div>
                                <div class="pm-exbar" role="img" aria-label="Execution ${awayEx ?? "not available"}">
                                    <div class="pm-exbar__half pm-exbar__half--neg">
                                    <div class="pm-exbar__fill pm-exbar__fill--neg" style="width: ${exNegWidth(awayEx)}%;"></div>
                                    </div>
                                    <div class="pm-exbar__mid">|</div>
                                    <div class="pm-exbar__half pm-exbar__half--pos">
                                    <div class="pm-exbar__fill pm-exbar__fill--pos" style="width: ${exPosWidth(awayEx)}%;"></div>
                                    </div>
                                </div>
                                <div class="pm-row__val">${fmtDelta(awayExDelta)}</div>
                            </div>
                            <!-- Power (spans both rows) -->
                                <div class="pm-power" aria-label="Power rating">
                                <div class="pm-power__num">${pe ? pe.awayPower : " - "}</div>
                                <div class="pm-power__label">Rating</div>
                            </div>

                        </div>
                    </div>

                        </div>
                    </fieldset>

                    <!-- STATS -->
                    <fieldset class="match-card-group">
                        <legend>Match stats</legend>
                        <div class="match-card-group__grid">
                    <div class="pm-stats" aria-label="Team match stats">
                        <div class="pm-team__label">${esc(home.display || home.name)}</div>
                        <div class="pm-stat"><span class="k" title="Expected Goals">xG</span><span class="v">${statNum("home", "xg")}</span></div>
                        <div class="pm-stat"><span class="k" title="Possession">Poss</span><span class="v">${stat("home", "poss")}</span></div>
                        <div class="pm-stat"><span class="k" title="Total Shots">Shots</span><span class="v">${statNum("home", "shots")}</span></div>
                        <div class="pm-stat"><span class="k" title="Shots: On Target, Inside Box, Blocked">S:TIB</span><span class="v">${statNum("home", "sot")} ${statNum("home", "shotsInsideBox")} ${statNum("home", "blockedShots")}</span></div>
                        <div class="pm-stat"><span class="k" title="Corners">Corners</span><span class="v">${statNum("home", "corners")}</span></div>
                        <div class="pm-stat"><span class="k" title="Fouls">Fouls</span><span class="v">${statNum("home", "fouls")}</span></div>
                        <div class="pm-stat"><span class="k" title="Yellow Cards">YC</span><span class="v">${statNum("home", "yc")}</span></div>
                        <div class="pm-stat"><span class="k" title="Red Cards">RC</span><span class="v">${statNum("home", "rc")}</span></div>
                        <div class="pm-stat"><span class="k" title="VAR-Disallowed">VAR-D</span><span class="v">${statNum("home", "disallowedGoals", 0)}</span></div>
                    </div>
                    <div class="pm-stats" aria-label="Team match stats">
                        <div class="pm-team__label">${esc(away.display || away.name)}</div>
                        <div class="pm-stat"><span class="k" title="Expected Goals">xG</span><span class="v">${statNum("away", "xg")}</span></div>
                        <div class="pm-stat"><span class="k" title="Possession">Poss</span><span class="v">${stat("away", "poss")}</span></div>
                        <div class="pm-stat"><span class="k" title="Total Shots">Shots</span><span class="v">${statNum("away", "shots")}</span></div>
                        <div class="pm-stat"><span class="k" title="Shots: On Target, Inside Box, Blocked">S:TIB</span><span class="v">${statNum("away", "sot")} ${statNum("away", "shotsInsideBox")} ${statNum("away", "blockedShots")}</span></div>
                        <div class="pm-stat"><span class="k" title="Corners">Corners</span><span class="v">${statNum("away", "corners")}</span></div>
                        <div class="pm-stat"><span class="k" title="Fouls">Fouls</span><span class="v">${statNum("away", "fouls")}</span></div>
                        <div class="pm-stat"><span class="k" title="Yellow Cards">YC</span><span class="v">${statNum("away", "yc")}</span></div>
                        <div class="pm-stat"><span class="k" title="Red Cards">RC</span><span class="v">${statNum("away", "rc")}</span></div>
                        <div class="pm-stat"><span class="k" title="VAR-Disallowed">VAR-D</span><span class="v">${statNum("away", "disallowedGoals", 0)}</span></div>
                    </div>
                        </div>
                    </fieldset>
                </section>

                <fieldset class="match-card-group match-card-group--timeline">
                    <legend>Timeline</legend>
                    <div class="match-body">${eventsHtml}</div>
                </fieldset>

                <footer class="match-footer">
                    <span class="footer-label">Venue:</span>
                    <span class="footer-data">${esc(match.venue)}</span>
                    ${matchHref ? `<a class="match-page-link" href="${esc(matchHref)}">Match page &#9655;</a>` : ""}
                    <button class="timeline-toggle" aria-expanded="${mode === "full" ? "true" : "false"}">
                        ${mode === "full" ? "Show Result" : "Show Timeline"}
                    </button>
                </footer>
            </article>
        `;
    };
}
