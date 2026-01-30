import "./style.css";
import teams from "./data/leagues/epl/2025/teams.json";
import { esc, sortedEvents } from "./lib/utils.js";
import { VIEW_MODES, isVisibleInMode, createRenderEventText, createRenderEventRow, createRenderMatchCard  } from "./lib/sharedRenderer.js";


// Runtime-loaded matchdays from /public/data (served at /data/...)
const MATCHDAYS = {};
const ALL_ROUNDS = Array.from({ length: 38 }, (_, i) => i + 1);

async function loadAllMatchdays() {
  const results = await Promise.allSettled(
    ALL_ROUNDS.map(async (round) => {
      const res = await fetch(`/data/leagues/epl/2025/matchdays/${round}.json`, {
        cache: "no-store",
      });
      if (!res.ok) return null; // allow missing rounds early season
      const md = await res.json();
      if (!md?.round) return null;
      return md;
    })
  );

  for (const r of results) {
    if (r.status !== "fulfilled" || !r.value) continue;
    MATCHDAYS[r.value.round] = r.value;
  }

  return Object.keys(MATCHDAYS)
    .map(Number)
    .sort((a, b) => a - b);
}

function getRoundFromPathname() {
  const m = window.location.pathname.match(/\/epl\/2025\/matchweek\/(\d+)\//);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

const SEASON_START = 2025;
const SEASON_LABEL = "2025–26";

function updateHeaderNav(round) {

  const MAX_ROUND = Math.max(...Object.keys(MATCHDAYS).map(Number));

  const hub = document.querySelector("#mw-hub");
  const prev = document.querySelector("#mw-prev");
  const next = document.querySelector("#mw-next");

  if (!hub || !prev || !next) return;

  hub.textContent = `EPL ${SEASON_LABEL} matchweeks`;
  hub.href = `/epl/${SEASON_START}/`;

  // prev
  if (round > 1) {
    prev.style.display = "";
    prev.href = `/epl/${SEASON_START}/matchweek/${round - 1}/`;
    prev.textContent = `← Matchweek ${round - 1}`;
    prev.setAttribute("aria-disabled", "false");
  } else {
    prev.style.display = "none"; // or disable visually
  }

  // next
  if (round < MAX_ROUND) {
    next.style.display = "";
    next.href = `/epl/${SEASON_START}/matchweek/${round + 1}/`;
    next.textContent = `Matchweek ${round + 1} →`;
    next.setAttribute("aria-disabled", "false");
  } else {
    next.style.display = "none";
  }
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

function setPageMetaForRound(round) {
  const title = `EPL 2025–26 Matchweek ${round} Timelines | Timeline Football`;
  document.title = title;

  const desc = `English Premier League 2025–26 Matchweek ${round} results with goal, card, VAR and substitution timelines.`;
  let meta = document.querySelector('meta[name="description"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "description");
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", desc);

  const canonicalHref = `${window.location.origin}/epl/2025/matchweek/${round}/`;
  let canon = document.querySelector('link[rel="canonical"]');
  if (!canon) {
    canon = document.createElement("link");
    canon.setAttribute("rel", "canonical");
    document.head.appendChild(canon);
  }
  canon.setAttribute("href", canonicalHref);
}

const renderEventText = createRenderEventText(esc);
const renderEventRow = createRenderEventRow(esc, renderEventText);
const renderMatchCard = createRenderMatchCard({
  esc,
  teamsById: teams,
  sortedEvents,
  isVisibleInMode,          // the shared one you already import
  renderEventRow,
  getModeForMatchId: (matchId) => viewModes.get(matchId) ?? VIEW_MODES.COMPACT
});

let currentRound = null;
let currentMatches = [];
let globalViewMode = VIEW_MODES.FULL; // start compact like you want

const viewModes = new Map();

const app = document.querySelector("#app");

function renderAllMatches() {
  app.innerHTML = `
    <div class="match-list">
      ${currentMatches.map(renderMatchCard).join("")}
    </div>
  `;
}

const matchdaySelect = document.querySelector("#matchday-select");
const showAllBtn = document.querySelector("#show-all-timelines");
const roundLabel = document.querySelector("#round-label");

let showAllAriaPressed = "false";
let roundName = "Matchweek"; // keep your variable

function renderControls() {
  // label text
  roundLabel.textContent = `${roundName}:`;

  // dropdown options
  matchdaySelect.innerHTML = Object.keys(MATCHDAYS)
    .map((round) => {
      const rNum = Number(round);
      const selected = rNum === currentRound ? "selected" : "";
      return `<option value="${rNum}" ${selected}>${rNum}</option>`;
    })
    .join("");

  // global button text + aria
  const showAllToggleText =
    globalViewMode === VIEW_MODES.FULL ? "Show Results" : "Show Timelines";

  showAllBtn.textContent = showAllToggleText;
  showAllBtn.setAttribute("aria-pressed", showAllAriaPressed);
}

async function init() {
  const allRounds = await loadAllMatchdays();

  if (!allRounds.length) {
    app.innerHTML = `<div class="match-list"><p>No matchday data found.</p></div>`;
    return;
  }

  const routeRound = getRoundFromPathname();

  const initialRound =
    (routeRound && MATCHDAYS[routeRound] ? routeRound : null) ??
    pickInitialRound(MATCHDAYS) ??
    allRounds[allRounds.length - 1];

  currentRound = initialRound;
  setPageMetaForRound(currentRound);

  updateHeaderNav(currentRound);

  currentMatches = MATCHDAYS[currentRound].matches;

  // initialize per-card modes to match the global mode
  viewModes.clear();
  for (const m of currentMatches) viewModes.set(String(m.id), globalViewMode);

  renderControls();
  renderAllMatches();
}

init().catch((err) => {
  console.error("Init failed:", err);
  app.innerHTML = `<div class="match-list"><p>Failed to load matchday data.</p></div>`;
});

document.addEventListener("click", (e) => {

  const globalBtn = e.target.closest(".show-all-timelines");

  if (globalBtn) {

    globalViewMode = globalViewMode === VIEW_MODES.FULL ? VIEW_MODES.COMPACT : VIEW_MODES.FULL;

    // set all cards to match global (Option A)
    for (const m of currentMatches) viewModes.set(String(m.id), globalViewMode);

    showAllAriaPressed = globalViewMode === VIEW_MODES.FULL ? "true" : "false";
    // showAllToggleText = globalViewMode === VIEW_MODES.FULL ? "Show Results" : "Show Timelines";

    renderControls();
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
  renderControls();
  renderAllMatches();
});

document.addEventListener("change", (e) => {
  const select = e.target.closest("#matchday-select");
  if (!select) return;

  const nextRound = Number(select.value);
  if (!MATCHDAYS[nextRound]) return;

  currentRound = nextRound;
  currentMatches = MATCHDAYS[currentRound].matches;

  updateHeaderNav(currentRound);

  // reset global + per-card state for the new matchday
  globalViewMode = VIEW_MODES.COMPACT;
  showAllAriaPressed = "false";

  history.replaceState(null, "", `/epl/2025/matchweek/${currentRound}/`);
  setPageMetaForRound(currentRound);


  viewModes.clear();
  for (const m of currentMatches) viewModes.set(String(m.id), globalViewMode);

  // re-render with the new round's matches
  renderControls();
  renderAllMatches();
});