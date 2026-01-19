import "./style.css";
import teams from "./data/leagues/epl/2025/teams.json";
import { esc, sortedEvents } from "./lib/utils.js";

// Load ALL matchdays for 2025 EPL
const matchdayModules = import.meta.glob(
  "./data/leagues/epl/2025/matchdays/*.json",
  { eager: true, import: "default" }
);

// Build a { roundNumber: matchdayJson } map
const MATCHDAYS = {};

for (const [, md] of Object.entries(matchdayModules)) {
  // each md should look like: { season, round, matches: [...] }
  const round = md.round;
  if (!round) continue;
  MATCHDAYS[round] = md;
}

function pickInitialRound(matchdays) {
  const now = Date.now();
  const GRACE_MS = 6 * 60 * 60 * 1000; // 6h buffer for late updates / timezones

  const rounds = Object.entries(matchdays)
    .map(([roundStr, md]) => {
      const round = Number(roundStr);
      const times = (md.matches || [])
        .map((m) => Date.parse(m.kickoff))
        .filter(Number.isFinite);

      if (!times.length) return null;

      return {
        round,
        minKickoff: Math.min(...times),
        maxKickoff: Math.max(...times),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.minKickoff - b.minKickoff);

  if (!rounds.length) return null;

  // 1) Prefer the round we are currently inside (earliest..latest)
  const current = rounds.find(
    (r) => now >= r.minKickoff - GRACE_MS && now <= r.maxKickoff + GRACE_MS
  );
  if (current) return current.round;

  // 2) Otherwise pick the next upcoming round (closest future)
  const next = rounds.find((r) => r.minKickoff > now);
  if (next) return next.round;

  // 3) Otherwise fall back to the most recent past round
  return rounds[rounds.length - 1].round;
}


const initialRound =
  pickInitialRound(MATCHDAYS) ?? allRounds[allRounds.length - 1];

let currentRound = initialRound;
let currentMatches = MATCHDAYS[currentRound].matches;


const VIEW_MODES = {
  COMPACT: "compact",
  FULL: "full",
};

let globalViewMode = VIEW_MODES.COMPACT; // start compact like you want

const viewModes = new Map();

// const matches = matchday.matches;

const app = document.querySelector("#app");

// let showAllToggleText = globalViewMode === VIEW_MODES.FULL ? "Show Results" : "Show Timelines";
let showAllAriaPressed = "false";
let roundName = "Matchweek"; // EPL Term. Other leagues use "Matchday", "Jornada", etc.

function renderAllMatches() {

  const showAllToggleText = globalViewMode === VIEW_MODES.FULL ? "Show Results" : "Show Timelines";

  app.innerHTML = `
    <div class="matchday-shell">
      <div class="matchday-header">
        <div class="matchday-container">
          <label for="matchday-select">${roundName}:</label>
          <select class="matchday-select" id="matchday-select">
            ${Object.keys(MATCHDAYS)
            .map((round) => {
              const rNum = Number(round);
              const selected = rNum === currentRound ? "selected" : "";
              return `<option value="${rNum}" ${selected}>${rNum}</option>`;
            })
            .join("")}
          </select>
        </div>
        <div class="show-all-container">
          <button class="show-all-timelines" type="button" aria-pressed="${showAllAriaPressed}">
            ${showAllToggleText}
          </button>
        </div>
      </div>
      <div class="match-list">
        ${currentMatches.map(renderMatchCard).join("")}
      </div>
    </div>
  `;
}

// initial render
renderAllMatches();

document.addEventListener("click", (e) => {

  const globalBtn = e.target.closest(".show-all-timelines");

  if (globalBtn) {

    globalViewMode = globalViewMode === VIEW_MODES.FULL ? VIEW_MODES.COMPACT : VIEW_MODES.FULL;

    // set all cards to match global (Option A)
    for (const m of currentMatches) viewModes.set(String(m.id), globalViewMode);

    showAllAriaPressed = globalViewMode === VIEW_MODES.FULL ? "true" : "false";
    // showAllToggleText = globalViewMode === VIEW_MODES.FULL ? "Show Results" : "Show Timelines";

    renderAllMatches();
    return;
  }

  // existing per-card toggle continues below...
});


document.addEventListener("click", (e) => {
  const btn = e.target.closest(".timeline-toggle");
  if (!btn) return;

  const card = btn.closest(".match-card");
  if (!card) return;

  const matchId = card.dataset.matchId;
  const match = currentMatches.find(m => String(m.id) === String(matchId));

  if (!match) return;

  const current = viewModes.get(matchId) ?? VIEW_MODES.COMPACT;
  const next = current === VIEW_MODES.COMPACT
    ? VIEW_MODES.FULL
    : VIEW_MODES.COMPACT;

  viewModes.set(matchId, next);

  // re-render everything for now (simpler + safe)
  renderAllMatches();
});

document.addEventListener("change", (e) => {
  const select = e.target.closest("#matchday-select");
  if (!select) return;

  const nextRound = Number(select.value);
  if (!MATCHDAYS[nextRound]) return;

  currentRound = nextRound;
  currentMatches = MATCHDAYS[currentRound].matches;

  // reset global + per-card state for the new matchday
  globalViewMode = VIEW_MODES.COMPACT;
  showAllAriaPressed = "false";

  viewModes.clear();
  for (const m of currentMatches) viewModes.set(String(m.id), globalViewMode);

  // re-render with the new round's matches
  renderAllMatches();
});

function isVisibleInMode(evt, mode) {

  if (mode === VIEW_MODES.FULL) {

    return true;

  }

  // COMPACT mode: show only "headline" stuff
  switch (evt.kind) {
    case "goal":
    case "red":
    case "own-goal":
      return true;
    default:
      return false; // hide yellows, subs, etc. in compact
  }
}

function renderMatchCard(match) {

  const home = teams[match.homeTeamId];
  const away = teams[match.awayTeamId];

  if (!home || !away) {
    throw new Error(`Unknown team id(s): ${match.homeTeamId}, ${match.awayTeamId}`);
  }

  const mode = viewModes.get(match.id) ?? VIEW_MODES.COMPACT;

  const gameStatus = esc(match.status?.state ?? "");
  console.log("Rendering match", match.id, "in mode", mode, "status:", gameStatus);

  let halfTimeScore = "";
  let gameMinute = parseInt(gameStatus, 10);

  if (isNaN(gameMinute)) {
    gameMinute = 0;
  }

  if ((gameMinute > 45) || (gameStatus === "FT")) {
    halfTimeScore = `(HT ${esc(match.status.halfTimeScore)})`;
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
    <div class="match-card" data-match-id="${match.id}">
        <div class="match-date">${esc(kickoffTime)}</div>
        <header class="match-header">
            <div class="ht-cont">
              <div class="team-badge-cont ${match.homeTeamId}">
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
              <div class="team-badge-cont ${match.awayTeamId}">
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
                ${mode === VIEW_MODES.FULL ? "Show Result" : "Show Timeline"}
            </button>
        </footer>
    </div>
  `;
}

/**
 * Formats player names to "F. Lastname".
 * Returns single names as-is and ignores already formatted names.
 */
function formatPlayerName(fullName) {
  const trimmedName = fullName.trim();

  // 1. Check if the name is already formatted (e.g., "L. Messi")
  // This regex looks for: Start of string -> One Letter -> A Period -> A Space
  if (/^[A-Z]\.\s/.test(trimmedName)) {
    return trimmedName;
  }

  // 2. Split by any whitespace
  const parts = trimmedName.split(/\s+/);

  // 3. Handle single-name players (Neymar, Pelé)
  if (parts.length === 1) {
    return parts[0];
  }

  // 4. Extract first initial and combine the rest
  const [first, ...rest] = parts;
  const initial = first.charAt(0).toUpperCase();
  const lastName = rest.join(" ");

  return `${initial}. ${lastName}`;
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
    if (evt.detail === "pen") { detail = `<span class="goal-detail">(Pen)</span>`; }

    let goalImg = '';
    const isOwnGoal = evt.kind === "own-goal";
    const label = isOwnGoal
      ? `<span class="player-goal">${player}</span><span class="own-goal-label" title="Own Goal" aria-label="Own Goal"> (OG)</span>`
      : `<span class="player-goal">${player}</span>`;

    const cls = isOwnGoal ? "evt-svg og-goal-ball" : "evt-svg goal-ball";
    const title = isOwnGoal ? "Own Goal" : "Goal";

    goalImg = `
                <span class="${cls}" title="${title}">
                    <svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                        <use href="/img/misc/ball.svg"></use>
                    </svg>
                </span>`;

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

}

function renderEventRow(evt, mode) {
  const minute = esc(evt.minute);

  const homeCell = evt.team === "home" ? renderEventText(evt, mode) : "";
  const awayCell = evt.team === "away" ? renderEventText(evt, mode) : "";

  if (evt.kind !== "var" && evt.detail !== "penalty confirmed")

    return `
    <div class="row">
      <div class="event home">${homeCell}</div>
      <div class="minute">${minute}</div>
      <div class="event away">${awayCell}</div>
    </div>
  `;
}