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

  const roundsWithDates = Object.entries(matchdays)
    .map(([roundStr, md]) => {
      const round = Number(roundStr);
      const dates = (md.matches || [])
        .map((m) => Date.parse(m.kickoff))
        .filter((t) => Number.isFinite(t));

      if (!dates.length) return null;

      // use the *latest* kickoff in this round
      const latestKickoff = Math.max(...dates);
      return { round, latestKickoff };
    })
    .filter(Boolean)
    .sort((a, b) => a.latestKickoff - b.latestKickoff);

  if (!roundsWithDates.length) return null;

  // 1) try to find the last round whose latest kickoff is <= now
  let best = roundsWithDates[0].round;
  for (const info of roundsWithDates) {
    if (info.latestKickoff <= now) {
      best = info.round;
    }
  }

  // if everything is in the future, `best` will stay at the earliest round
  return best;
}

const initialRound =
  pickInitialRound(MATCHDAYS) ?? allRounds[allRounds.length - 1];

let currentRound = initialRound;
let currentMatches = MATCHDAYS[currentRound].matches;


const VIEW_MODES = {
  COMPACT: "compact",
  FULL: "full",
};

// let currentViewMode = VIEW_MODES.COMPACT;

const viewModes = new Map();

// const matches = matchday.matches;

const app = document.querySelector("#app");

function renderAllMatches() {
  app.innerHTML = `
    <div class="matchday-shell">
      <div class="matchday-header">
        <label for="round-select">Matchday:</label>
        <select id="round-select">
          ${Object.keys(MATCHDAYS)
            .map((round) => {
              const rNum = Number(round);
              const selected = rNum === currentRound ? "selected" : "";
              return `<option value="${rNum}" ${selected}>${rNum}</option>`;
            })
            .join("")}
        </select>
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
  const select = e.target.closest("#round-select");
  if (!select) return;

  const nextRound = Number(select.value);
  if (!MATCHDAYS[nextRound]) return;

  currentRound = nextRound;
  currentMatches = MATCHDAYS[currentRound].matches;

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

    const statusLine = esc(match.status?.state ?? "");
    const ht = match.status?.halfTimeScore ? `(${esc(match.status.halfTimeScore)})` : "";
    
    const allEvents = sortedEvents(match.events || []);

    const eventsHtml = allEvents
    .filter((evt) => isVisibleInMode(evt, mode))
    .map((evt) => renderEventRow(evt, mode))
    .join("");


    // const attendance = Number(match.attendance);
    // const attendanceText = Number.isFinite(attendance) ? attendance.toLocaleString() : "";

    return `
    <div class="match-card" data-match-id="${match.id}">
        <div class="league-name">${esc(match.league)}</div>
        <header class="match-header">
            <div class="ht-cont">
                <div class="team home">${esc(home.name)}</div>
                <img class="team-badge" src="${esc(home.badge)}" alt="${esc(home.name)} badge" />
            </div>
            <div class="score">
                <div class="score-home">${esc(match.score.home)}</div>
                <span class="separator" aria-hidden="true"></span>
                <div class="score-away">${esc(match.score.away)}</div>
            </div>
            <div class="at-cont">
                <img class="team-badge" src="${esc(away.badge)}" alt="${esc(away.name)} badge" />
                <div class="team away">${esc(away.name)}</div>
            </div>
        </header>
        <div class="match-status">
            <span class="full-time">${statusLine}</span>
            <span class="half-time">${ht}</span>
        </div>
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

function renderEventText(evt, mode) {

    const player = esc(evt.player ?? "");
    const playerIn = esc(evt.inPlayer ?? "");
    const playerOut = esc(evt.outPlayer ?? "");

    if (evt.kind === "red") {
    const second = evt.secondYellow === true;

    const yellowIcon = second
        ? `<span class="card yellow second-yellow"
                 title="Second yellow card"
                 aria-label="Second yellow card"></span>`
        : "";

    return `
        <span class="player">${player}</span>
        ${yellowIcon}
        <span class="card red"
              title="${second ? "Red card (2nd yellow)" : "Red card"}"
              aria-label="${second ? "Red card (2nd yellow)" : "Red card"}"></span>
    `;
}

    if (evt.kind === "yellow") {
        return `
            <span class="player">${player}</span>
            <span class="card yellow" title="Yellow card" aria-label="Yellow card"></span>
        `;
    }

    // goal
    if (evt.kind === "goal" || evt.kind === "own-goal") {

        const assist = evt.assist ? `<span class="assist">(${esc(evt.assist)})</span>` : "";
        
        let detail = "";
        if (evt.detail === "pen") {detail = `<span class="goal-detail"> (Penalty)</span>`;}

        let goalImg = '';
        const isOwnGoal = evt.kind === "own-goal";
        const label = isOwnGoal
            ? `<span class="player">${player}</span><span class="own-goal-label" title="Own Goal" aria-label="Own Goal"> (OG)</span>`
            : `<span class="player">${player}</span>`;

        if (mode === VIEW_MODES.FULL){

            const cls = isOwnGoal ? "evt-svg og-goal-ball" : "evt-svg goal-ball";
            const title = isOwnGoal ? "Own Goal" : "Goal";

            goalImg = `
                <span class="${cls}" title="${title}" aria-label="${title}">
                    <svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                        <use href="/img/misc/ball.svg"></use>
                    </svg>
                </span>`;
        }

        const metaBits = `${assist || ""}${detail || ""}`;

        return `
            ${label}${goalImg}${metaBits ? ` <span class="event-meta">${metaBits}</span>` : ""}
        `;

    }

    /* NEW: missed penalty */
    if (evt.kind === "penalty-miss") {

        const player = esc(evt.player ?? "");

        let missImg = "";
        if (mode === VIEW_MODES.FULL){
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

    if (evt.kind === "var-goal-cancelled" || evt.kind === "var-goal-disallowed") {
        const player = esc(evt.player ?? "");

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

        const vgc = evt.kind === "var-goal-cancelled"  ? `<span class="var var-no-goal">${varEvent + 'Cancelled'})</span>` : "";
        const vgd = evt.kind === "var-goal-disallowed" ? `<span class="var var-no-goal">${varEvent + 'Offside'})</span>` : "";

        let metaBits = `${vgc}${vgd}`;

        return `
            <span class="player var-player">${player}</span>
            ${varIcon}
            ${metaBits ? ` <span class="event-meta">${metaBits}</span>` : ""}
        `;
    }

    if (evt.kind === "var-pen-cancelled" || evt.kind === "var-pen-confirmed" || evt.kind === "var-card-upgrade") {
      const player = esc(evt.player ?? "");

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

      const vgc = evt.kind === "var-pen-cancelled"  ? `<span class="var var-no-goal">${varEvent + 'PEN Cancelled'})</span>` : "";
      const vgd = evt.kind === "var-pen-confirmed" ? `<span class="var var-pen-awarded">${varEvent + 'PEN Awarded'})</span>` : "";
      const vcu = evt.kind === "var-card-upgrade"  ? `<span class="var var-card-upgrade">${varEvent + 'Card Upgraded'})</span>` : "";

      let metaBits = `${vgc}${vgd}${vcu}`;

      return `
          <span class="player var-player">${player}</span>
          ${metaBits ? ` <span class="event-meta">${metaBits}</span>` : ""}
      `;
    }

    // Substitution
    if (evt.kind === "sub") {
        
        return `
            <span class="player">${playerOut}</span>
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