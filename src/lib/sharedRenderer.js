import playerData from "../data/leagues/epl/2025/players.json" with { type: "json" };
import { computePerfExec } from "./powerMeter.js";

const players = playerData || {}; // preventing app failure from missing file

export const VIEW_MODES = {
    COMPACT: "compact",
    FULL: "full",
};

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

function getPlayerTitle(playerId, fallbackName) {
    if (!playerId) return fallbackName || "";
    const p = players?.[String(playerId)];
    return p?.fullName || p?.name || fallbackName || "";
}

export function isVisibleInMode(evt, mode) {
    if (mode === VIEW_MODES.FULL) return true;

    switch (evt.kind) {
        case "goal":
        case "red":
        case "own-goal":
            return true;
        default:
            return false;
    }
}

export function createRenderEventText(esc) {

    return function renderEventText(evt, mode) {

        const player = formatPlayerName(esc(evt.player ?? ""));
        const playerIn = formatPlayerName(esc(evt.inPlayer ?? ""));
        const playerOut = formatPlayerName(esc(evt.outPlayer ?? ""));
        const playerTitle = getPlayerTitle(evt.playerId, evt.player);
        const assistTitle = getPlayerTitle(evt.assistId, evt.assist);

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
                            <span class="evt-svg ${iconClass}" title="${iconTitle}">
                                <svg width="18" height="18" viewBox="0 0 16 16">
                                    <use href="/img/misc/ball.svg"></use>
                                </svg>
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
                    <span class="evt-svg missed-pen-ball" title="Missed penalty" aria-label="Missed penalty">
                        <svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                            <use href="/img/misc/ball.svg"></use>
                        </svg>
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
                const showIcon = mode === VIEW_MODES.FULL && config.isDisallowed;
                const varIcon = showIcon ? `
                    <span class="evt-svg var-goal-cancelled-icon" title="Disallowed (VAR)" aria-label="Goal Disallowed (VAR)">
                        <svg width="16" height="16" viewBox="0 0 16 16"><use href="/img/misc/ball.svg"></use></svg>
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
                    <svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                        <use href="/img/misc/sub.svg" />
                    </svg>
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

        const homeCell = evt.team === "home" ? renderEventText(evt, mode) : "";
        const awayCell = evt.team === "away" ? renderEventText(evt, mode) : "";

        if (evt.kind !== "var" && evt.detail !== "penalty confirmed") {

            return `
                <div class="row">
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

        const pe = ((state === "FT" || state === "HT") && hasStats)
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

        const homeHref = `/epl/2025-26/team/${match.homeTeamId}/`;
        const awayHref = `/epl/2025-26/team/${match.awayTeamId}/`;

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
            if (d == null) return "—";
            if (d > 0) return `+${d}`;
            return `${d}`;
        };

        return `
            <article id="fixture-${match.id}" class="match-card" data-match-id="${match.id}">
                <div class="match-date">${esc(kickoffTime)}</div>

                <header class="match-header">
                    <div class="ht-cont">
                        <a href="${esc(homeHref)}" class="team-link">
                        <div class="team-badge-cont title="${esc(home.nicknames[0] || "")}">
                            <img class="team-badge ${match.homeTeamId}" src="${esc(home.badge)}" alt="${esc(home.name)} badge" />
                        </div>
                        <div class="team home" title="Team Page">${esc(home.display || home.name)}</div>
                        </a>
                    </div>

                    <div class="score-container">
                        <div class="score">
                            <div class="score-home">${esc(match.score.home)}</div>
                            <span class="separator" aria-hidden="true"></span>
                            <div class="score-away">${esc(match.score.away)}</div>
                        </div>
                        <div class="match-status">
                            <span class="half-time">${gameStatus} ${halfTimeScore}</span>
                        </div>
                    </div>

                    <div class="at-cont">
                        <a href="${esc(awayHref)}" class="team-link">
                        <div class="team-badge-cont title="${esc(away.nicknames[0] || "")}">
                            <img class="team-badge ${match.awayTeamId}" src="${esc(away.badge)}" alt="${esc(away.name)} badge" />
                        </div>
                        <div class="team away" title="Team Page">${esc(away.display || away.name)}</div>
                        </a>
                    </div>
                </header>

                <section id="stats" class="power-meter" aria-label="Match power meter">
                    <!-- HOME -->
                    <div class="pm-team pm-team--home">
                        <div class="pm-team__label">${esc(home.display || home.name)}</div>

                        <div class="pm-grid">
                            <!-- Perf row -->
                            <div class="pm-row">
                                <div class="pm-row__name" title="Match Control Index">mX</div>
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
                                <div class="pm-row__name" title="Match Control Index">mX</div>
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

                    <!-- STATS -->
                    <div class="pm-stats" aria-label="Team match stats">
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
                </section>

                <div class="match-body">${eventsHtml}</div>

                <footer class="match-footer">
                    <span class="footer-label">Venue:</span>
                    <span class="footer-data">${esc(match.venue)}</span>
                    <button class="timeline-toggle" aria-expanded="false">
                        ${mode === "full" ? "Show Result" : "Show Timeline"}
                    </button>
                </footer>
            </article>
        `;
    };
}