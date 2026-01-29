import { esc, sortedEvents } from "../utils.js";

/**
 * Render a full matchweek into HTML.
 * This must be Node-safe: no DOM access, no document/window.
 */
export function renderMatchweekHTML({ matches, teams, globalMode = "compact" }) {
  const viewModes = new Map(matches.map((m) => [String(m.id), globalMode]));

  return `
    <div class="match-list">
      ${matches.map((m) => renderMatchCard(m, teams, viewModes.get(String(m.id)))).join("")}
    </div>
  `;
}

/**
 * Formats player names to "F. Lastname".
 * Returns single names as-is and ignores already formatted names.
 */
function formatPlayerName(fullName) {
  const trimmedName = String(fullName ?? "").trim();

  // 1) Already formatted (e.g., "L. Messi")
  if (/^[A-Z]\.\s/.test(trimmedName)) {
    return trimmedName;
  }

  // 2) Split by whitespace
  const parts = trimmedName.split(/\s+/);

  // 3) Single-name players
  if (parts.length === 1) {
    return parts[0] || "";
  }

  // 4) First initial + rest
  const [first, ...rest] = parts;
  const initial = (first?.charAt(0) || "").toUpperCase();
  const lastName = rest.join(" ");

  return `${initial}. ${lastName}`.trim();
}

function renderMatchCard(match, teams, mode) {
  const home = teams[match.homeTeamId];
  const away = teams[match.awayTeamId];

  if (!home || !away) {
    throw new Error(`Unknown team id(s): ${match.homeTeamId}, ${match.awayTeamId}`);
  }

  const gameStatus = esc(match.status?.state ?? "");

  let halfTimeScore = "";
  let gameMinute = parseInt(gameStatus, 10);
  if (Number.isNaN(gameMinute)) gameMinute = 0;

  if (gameMinute > 45 || gameStatus === "FT") {
    halfTimeScore = match.status?.halfTimeScore ? `(HT ${esc(match.status.halfTimeScore)})` : "";
  }

  const allEvents = sortedEvents(match.events || []);
  const eventsHtml = allEvents
    .filter((evt) => isVisibleInMode(evt, mode))
    .map((evt) => renderEventRow(evt, mode))
    .join("");

  const kickoffTime = match.kickoff
    ? new Date(match.kickoff).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "TBD";

  return `
    <div class="match-card" id="fixture-${match.id}" data-match-id="${esc(match.id)}">
      <div class="match-date">${esc(kickoffTime)}</div>
      <header class="match-header">
        <div class="ht-cont">
          <div class="team-badge-cont ${esc(match.homeTeamId)}" title="${esc(home.nicknames[0])}">
            <img class="team-badge ${esc(match.homeTeamId)}" src="${esc(home.badge)}" alt="${esc(home.name)} badge" />
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
          <div class="team-badge-cont ${esc(match.awayTeamId)}" title="${esc(away.nicknames[0])}">
            <img class="team-badge ${esc(match.awayTeamId)}" src="${esc(away.badge)}" alt="${esc(away.name)} badge" />
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
}

function isVisibleInMode(evt, mode) {
  if (mode === "full") return true;

  // compact: headline only
  switch (evt.kind) {
    case "goal":
    case "red":
    case "own-goal":
      return true;
    default:
      return false;
  }
}

// --- event rendering ---
// NOTE: We'll paste your exact renderEventText/formatPlayerName logic next step,
// so for now these are placeholders to keep the module valid.

function renderEventRow(evt, mode) {
  const minute = esc(evt.minute);
  const homeCell = evt.team === "home" ? renderEventText(evt, mode) : "";
  const awayCell = evt.team === "away" ? renderEventText(evt, mode) : "";

  return `
    <div class="row">
      <div class="event home">${homeCell}</div>
      <div class="minute">${minute}</div>
      <div class="event away">${awayCell}</div>
    </div>
  `;
}

function renderEventText(evt, mode) {

  const player = formatPlayerName(esc(evt.player ?? ""));
  const playerIn = formatPlayerName(esc(evt.inPlayer ?? ""));
  const playerOut = formatPlayerName(esc(evt.outPlayer ?? ""));

  if (evt.kind === "red") {
    const second = evt.secondYellow === true;

    const yellowIcon = second
      ? `<span class="card yellow second-yellow"
                 title="Second yellow card"
                 aria-label="Second yellow card"
                 role="img"></span>`
      : "";

    return `
        <span class="player player-red" title="${evt.comments}">${player}</span>
        ${yellowIcon}
        <span class="card red"
              title="${second ? "Red card (2nd yellow)" : "Red card"}"
              aria-label="${second ? "Red card (2nd yellow)" : "Red card"}" role="img"></span>
    `;
  }

  if (evt.kind === "yellow") {
    return `
            <span class="player player-yellow" title="${evt.comments}">${player}</span>
            <span class="card yellow" title="Yellow card" aria-label="Yellow card" role="img"></span>
        `;
  }

  // goal
  if (evt.kind === "goal" || evt.kind === "own-goal") {

    const assist = evt.assist ? `<span class="assist">(${formatPlayerName(esc(evt.assist))})</span>` : "";

    let detail = "";
    if (evt.detail === "pen") { detail = `<span class="goal-detail">(Pen)</span>`; };
    if (evt.kind === "own-goal") { detail = `</span><span class="own-goal-label" title="Own Goal" aria-label="Own Goal"> (Own Goal)</span>`; };

    const label = `<span class="player-goal">${player}</span>`;
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

    // if (mode === VIEW_MODES.FULL) {

    //   const cls = isOwnGoal ? "evt-svg og-goal-ball" : "evt-svg goal-ball";
    //   const title = isOwnGoal ? "Own Goal" : "Goal";

    //   goalImg = `
    //             <span class="${cls}" title="${title}" aria-label="${title}">
    //                 <svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    //                     <use href="/img/misc/ball.svg"></use>
    //                 </svg>
    //             </span>`;
    // }

    const metaBits = `${assist || ""}${detail || ""}`;

    return `
            ${label}${goalImg}${metaBits ? ` <span class="event-meta">${metaBits}</span>` : ""}
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
            <span class="player">${player}</span>
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

    let varEvent = '(VAR · ';

    const vgc = evt.kind === "var-goal-cancelled" ? `<span class="var var-no-goal">${varEvent + 'Cancelled'})</span>` : "";
    const vgd = evt.kind === "var-goal-disallowed" ? `<span class="var var-no-goal">${varEvent + 'Offside'})</span>` : "";
    const vga = evt.kind === "var-goal-confirmed" ? `<span class="var var-goal-confirmed">${varEvent + 'Confirmed'})</span>` : "";

    let metaBits = `${vgc}${vgd}${vga}`;

    if (vgc || vgd) {

      return `
          <span class="player var-player">${player}</span>
          ${varIcon}
          ${metaBits ? ` <span class="event-meta">${metaBits}</span>` : ""}
      `;

    }

    if (vga) {

      return `
        ${metaBits ? ` <span class="event-meta">${metaBits}</span>` : ""}
    `;

    }

  }

  if (evt.kind === "var-pen-cancelled" || evt.kind === "var-pen-confirmed" || evt.kind === "var-card-upgrade") {


    // let varIcon = "";
    // if (mode === VIEW_MODES.FULL) {
    //     varIcon = `
    //     <span class="evt-svg var-goal-cancelled-icon" title="Disallowed (VAR)" aria-label="Goal Disallowed (VAR)">
    //         <svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    //             <use href="/img/misc/ball.svg"></use>
    //         </svg>
    //     </span>
    //     `;
    // }

    let varEvent = '(VAR · ';

    const vgc = evt.kind === "var-pen-cancelled" ? `<span class="var var-no-goal">${varEvent + 'Pen Cancelled'})</span>` : "";
    const vgd = evt.kind === "var-pen-confirmed" ? `<span class="var var-pen-awarded">${varEvent + 'Pen Awarded'})</span>` : "";
    const vcu = evt.kind === "var-card-upgrade" ? `<span class="var var-card-upgrade">${varEvent + 'Card Upgraded'})</span>` : "";

    let metaBits = `${vgc}${vgd}${vcu}`;

    return `
          <span class="player var-player">${player}</span>
          ${metaBits ? ` <span class="event-meta">${metaBits}</span>` : ""}
      `;
  }

  // Substitution
  if (evt.kind === "sub") {

    return `
            <span class="player subbed">${playerOut}</span>
            <span class="evt-svg sub-arrow" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <use href="/img/misc/sub.svg" />
                </svg>
            </span>
            <span class="event-meta">
                <span class="sub">${playerIn}</span>
            </span>
        `;
  }

  return "";

}