import playerData from "../data/leagues/epl/2025/players.json" with { type: "json" };

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

            const reason = evt.comments ? esc(evt.comments) : "other";
            const meta = reason ? ` <span class="event-meta foul">(${reason})</span>` : "";

            if (evt.kind === "red") {
                const second = evt.secondYellow === true;

                const yellowIcon = second
                    ? `<span class="card yellow second-yellow"
                     title="Second yellow card"
                     aria-label="Second yellow card"
                     role="img"></span>`
                    : "";

                return `
            <span class="player player-red" title="${esc(playerTitle)}">${player}</span>
            ${yellowIcon}
            <span class="card red"
                  title="${second ? "Red card (2nd yellow)" : "Straight Red card"}"
                  aria-label="${second ? "Red card (2nd yellow)" : "Straight Red card"}" role="img">
            </span>
            ${meta}
        `;
            }

            if (evt.kind === "yellow") {
                return `
                <span class="player player-yellow" title="${esc(playerTitle)}">${player}</span>
                <span class="card yellow" title="Yellow card" aria-label="Yellow card" role="img"></span>
                ${meta}
            `;
            }
        }

        // goal
        if (evt.kind === "goal" || evt.kind === "own-goal") {

            const assist = evt.assist ? `<span class="assist" title="${esc(assistTitle)}">(${formatPlayerName(esc(evt.assist))})</span>` : "";

            let detail = "";
            if (evt.detail === "pen") { detail = `<span class="goal-detail">(Pen)</span>`; };
            if (evt.kind === "own-goal") { detail = `</span><span class="own-goal-label" title="Own Goal" aria-label="Own Goal"> (Own Goal)</span>`; };

            const label = `<span class="player-goal" title="${esc(playerTitle)}">${player}</span>`;
            const isOwnGoal = evt.kind === "own-goal";
            const cls = isOwnGoal ? "evt-svg og-goal-ball" : "evt-svg goal-ball";
            const title = isOwnGoal ? "Own Goal" : "Goal";

            let goalImg = `
                    <span class="${cls}" title="${title}">
                        <svg width="18" height="18" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                            <use href="/img/misc/ball.svg"></use>
                        </svg>
                    </span>
                  `;

            const meta = `${assist || ""}${detail || ""}`;

            return `
                ${label}${goalImg}${meta ? ` <span class="event-meta">${meta}</span>` : ""}
            `;

        }

        /* NEW: missed penalty */
        if (evt.kind === "penalty-miss") {

            let missImg = "";
            if (mode === VIEW_MODES.FULL) {
                missImg = `
                    <span class="evt-svg missed-pen-ball" title="Missed penalty" aria-label="Missed penalty">
                        <svg width="16" height="16" viewBox="0 0 16 16"
                            xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
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

            let varIcon = "";
            if (mode === VIEW_MODES.FULL) {
                varIcon = `
                <span class="evt-svg var-goal-cancelled-icon" title="Disallowed (VAR)" aria-label="Goal Disallowed (VAR)">
                    <svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                        <use href="/img/misc/ball.svg"></use>
                    </svg>
                </span>
                `;
            }

            let varEvent = '<span class="var-event">VAR</span>';

            const vgc = evt.kind === "var-goal-cancelled" ? `<span class="var var-no-goal">${varEvent + ' (Overturned'})</span>` : "";
            const vgdo = evt.kind === "var-goal-disallowed-offside" ? `<span class="var var-no-goal">${varEvent + ' (Offside'})</span>` : "";
            const vgd = evt.kind === "var-goal-disallowed" ? `<span class="var var-no-goal">${varEvent + ' (Disallowed'})</span>` : "";
            const vga = evt.kind === "var-goal-confirmed" ? `<span class="var var-goal-confirmed">${varEvent + ' (Confirmed'})</span>` : "";

            let meta = `${vgc}${vgdo}${vgd}${vga}`;

            if (vgc || vgdo || vgd) {

                return `
                    <span class="player var-player" title="${esc(playerTitle)}">${player}</span>
                    ${varIcon}
                    ${meta ? ` <span class="event-meta">${meta}</span>` : ""}
                `;

            }

            if (vga) {

                return `
                    ${meta ? ` <span class="event-meta">${meta}</span>` : ""}
                `;

            }

        }

        if (evt.kind === "var-pen-cancelled" || evt.kind === "var-pen-confirmed" || evt.kind === "var-card-upgrade") {

            let varEvent = '<span class="var-event">VAR</span>';

            const vgc = evt.kind === "var-pen-cancelled" ? `<span class="var var-no-goal">${varEvent + ' (Pen Overturned'})</span>` : "";
            const vgd = evt.kind === "var-pen-confirmed" ? `<span class="var var-pen-awarded">${varEvent + ' (Pen Awarded'})</span>` : "";
            const vcu = evt.kind === "var-card-upgrade" ? `<span class="var var-card-upgrade">${varEvent + ' (Card Upgraded'})</span>` : "";

            let meta = `${vgc}${vgd}${vcu}`;

            return `
                <span class="player var-player" title="${esc(playerTitle)}">${player}</span>
                ${meta ? ` <span class="event-meta">${meta}</span>` : ""}
            `;
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

        return `
            <div class="match-card" data-match-id="${match.id}">
                <div class="match-date">${esc(kickoffTime)}</div>

                <header class="match-header">
                <div class="ht-cont">
                    <div class="team-badge-cont ${match.homeTeamId}" title="${esc(home.nicknames[0] || "")}">
                    <img class="team-badge ${match.homeTeamId}" src="${esc(home.badge)}" alt="${esc(home.name)} badge" />
                    </div>
                    <div class="team home">${esc(home.display || home.name)}</div>
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
                    <div class="team-badge-cont ${match.awayTeamId}" title="${esc(away.nicknames[0] || "")}">
                    <img class="team-badge ${match.awayTeamId}" src="${esc(away.badge)}" alt="${esc(away.name)} badge" />
                    </div>
                    <div class="team away">${esc(away.display || away.name)}</div>
                </div>
                </header>

                <div class="match-body">${eventsHtml}</div>

                <footer class="match-footer">
                <span class="footer-label">Venue:</span>
                <span class="footer-data">${esc(match.venue)}</span>
                <button class="timeline-toggle" aria-expanded="false">
                    ${mode === "full" ? "Show Result" : "Show Timeline"}
                </button>
                </footer>
            </div>
        `;
    };
}