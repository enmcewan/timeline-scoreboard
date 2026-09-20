import "./style.css";
import teams2025 from "./data/leagues/epl/2025/teams.json";
import players2025 from "./data/leagues/epl/2025/players.json";
import teams2026 from "./data/leagues/epl/2026/teams.json";
import players2026 from "./data/leagues/epl/2026/players.json";
import { getSeasonConfigFromPathname, publicSeasonDataPath } from "./config/seasons.js";
import { esc, sortedEvents } from "./lib/utils.js";
import { VIEW_MODES, isVisibleInMode, createRenderEventText, createRenderEventRow, createRenderMatchCard } from "./lib/sharedRenderer.js";

const season = getSeasonConfigFromPathname(window.location.pathname);
const teamsBySeason = {
  "2025-26": teams2025,
  "2026-27": teams2026,
};
const playersBySeason = {
  "2025-26": players2025,
  "2026-27": players2026,
};
const teams = teamsBySeason[season.seasonPath];
const players = playersBySeason[season.seasonPath] || {};

// Runtime-loaded matchdays from /public/data (served at /data/...)
const MATCHDAYS = {};
let ODDS_BY_FIXTURE = {};
const ALL_ROUNDS = Array.from({ length: season.maxRound }, (_, i) => i + 1);
const SEASON_DATA_PATH = publicSeasonDataPath(season);
const LIVE_DATA_TIMEOUT_MS = 4000;
const LIVE_DATA_MAX_AGE_MS = 60 * 60 * 1000;
const AUTO_UPDATE_STORAGE_KEY = `timeline-auto-update:${season.seasonPath}`;
// Lauris runs at :03, :18, :33 and :51. Allow two minutes to publish.
const AUTO_UPDATE_MINUTES_UTC = [5, 20, 35, 53];
const MATCH_WINDOW_BEFORE_MS = 10 * 60 * 1000;
const MATCH_WINDOW_AFTER_MS = 195 * 60 * 1000;

async function loadAllMatchdays() {
  const results = await Promise.allSettled(
    ALL_ROUNDS.map(async (round) => {
      const res = await fetch(`/${SEASON_DATA_PATH}/matchweeks/${round}.json`, {
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

async function loadLiveCurrentMatchday() {
  if (!season.liveDataBaseUrl || season.isArchived) return null;

  const isMatchweekPage = /^\/epl\/\d{4}-\d{2}\/matchweek\/(?:\d+|current)\/?$/.test(
    window.location.pathname
  );
  if (window.location.pathname !== "/" && !isMatchweekPage) return null;

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), LIVE_DATA_TIMEOUT_MS);
  const url = `${season.liveDataBaseUrl}/${season.leagueKey}/${season.seasonPath}/matchweeks/current.json`;

  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const matchday = await res.json();
    const round = Number(matchday?.round);
    const publishedAt = Date.parse(matchday?.publishedAt || "");
    const ageMs = Date.now() - publishedAt;

    if (!Number.isInteger(round) || round < 1 || round > season.maxRound) {
      throw new Error("invalid round");
    }
    if (!Array.isArray(matchday?.matches) || matchday.matches.length === 0) {
      throw new Error("missing matches");
    }
    if (matchday.seasonPath && matchday.seasonPath !== season.seasonPath) {
      throw new Error("season mismatch");
    }
    if (!Number.isFinite(ageMs) || ageMs < -5 * 60 * 1000 || ageMs > LIVE_DATA_MAX_AGE_MS) {
      throw new Error("stale publishedAt");
    }

    const previousPublishedAt = Date.parse(MATCHDAYS[round]?.publishedAt || "");
    MATCHDAYS[round] = matchday;
    liveCurrentRound = round;
    livePublishedAtMs = publishedAt;
    console.info(`Using live matchday data for round ${round}.`);
    return {
      round,
      publishedAt,
      changed: !Number.isFinite(previousPublishedAt) || publishedAt > previousPublishedAt,
    };
  } catch (err) {
    console.warn("Live matchday data unavailable; using bundled data:", err);
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function loadOdds() {
  try {
    const res = await fetch(`/${SEASON_DATA_PATH}/odds.json`, {
      cache: "no-store",
    });
    if (!res.ok) return;

    const oddsJson = await res.json();
    ODDS_BY_FIXTURE = oddsJson?.fixtures ?? {};
  } catch (err) {
    console.warn("Odds data unavailable:", err);
    ODDS_BY_FIXTURE = {};
  }
}

function attachMatchData(matches, round) {
  return matches.map((match) => {
    const odds = ODDS_BY_FIXTURE[String(match.id)];
    return {
      ...match,
      round,
      ...(odds ? { odds } : {}),
    };
  });
}

function getRoundFromPathname() {
  const m = window.location.pathname.match(/\/epl\/\d{4}-\d{2}\/matchweek\/(\d+|current)(?:\/|$)/); // fixed for ...matchweek/10 - no trailing slash
  if (!m) return null;
  if (m[1] === "current") return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

const SEASON_PATH = season.seasonPath;
const SEASON_LABEL = season.displaySeasonLabel;

function updateHeaderNav(round) {

  const MAX_ROUND = Math.max(...Object.keys(MATCHDAYS).map(Number));

  const hub = document.querySelector("#mw-hub");
  const prev = document.querySelector("#mw-prev");
  const next = document.querySelector("#mw-next");

  if (!hub || !prev || !next) return;

  hub.textContent = `EPL ${SEASON_LABEL} matchweeks`;
  hub.href = `/epl/${SEASON_PATH}/`;


  const arrowLeft = `
                      <span class="nav-arrow">
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-arrow-left-circle" viewBox="0 0 16 16">
                              <path fill-rule="evenodd" d="M1 8a7 7 0 1 0 14 0A7 7 0 0 0 1 8m15 0A8 8 0 1 1 0 8a8 8 0 0 1 16 0m-4.5-.5a.5.5 0 0 1 0 1H5.707l2.147 2.146a.5.5 0 0 1-.708.708l-3-3a.5.5 0 0 1 0-.708l3-3a.5.5 0 1 1 .708.708L5.707 7.5z"/>
                          </svg>    
                      </span>
                  `;

  const arrowRight = `
                      <span class="nav-arrow">
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-arrow-right-circle" viewBox="0 0 16 16">
                              <path fill-rule="evenodd" d="M1 8a7 7 0 1 0 14 0A7 7 0 0 0 1 8m15 0A8 8 0 1 1 0 8a8 8 0 0 1 16 0M4.5 7.5a.5.5 0 0 0 0 1h5.793l-2.147 2.146a.5.5 0 0 0 .708.708l3-3a.5.5 0 0 0 0-.708l-3-3a.5.5 0 1 0-.708.708L10.293 7.5z"/>
                          </svg>  
                      </span>
                  `;

  // prev
  if (round > 1) {
    prev.style.display = "";
    prev.href = `/epl/${SEASON_PATH}/matchweek/${round - 1}/`;
    prev.innerHTML = `${arrowLeft} Matchweek ${round - 1}`;
    prev.setAttribute("aria-disabled", "false");
  } else {
    prev.style.display = "none"; // or disable visually
  }

  // next
  if (round < MAX_ROUND) {
    next.style.display = "";
    next.href = `/epl/${SEASON_PATH}/matchweek/${round + 1}/`;
    next.innerHTML = `Matchweek ${round + 1} ${arrowRight}`;
    next.setAttribute("aria-disabled", "false");
  } else {
    next.style.display = "none";
  }
}

function isCompletedState(state) {
  const s = String(state ?? "").trim().toUpperCase();
  return s === "FT" || s === "AET" || s === "PEN";
}

function pickCurrentRoundByCompletion(matchdays) {
  const rounds = Object.keys(matchdays).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  for (const r of rounds) {
    const md = matchdays[r];
    const matches = md?.matches || [];
    if (!matches.length) continue;

    // If any match is not completed, this round is the current one
    if (matches.some(m => !isCompletedState(m.status?.state))) {
      return r;
    }
  }
  return null;
}

function setPageMetaForRound(round) {
  const title = `${season.leagueShortName} ${SEASON_LABEL} Matchweek ${round} Timelines, Stats & Ratings`;
  document.title = title;

  const desc = `${season.leagueName} ${SEASON_LABEL} Matchweek ${round} results with goals, cards, VAR, odds, stats and team ratings.`;
  let meta = document.querySelector('meta[name="description"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "description");
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", desc);

  const canonicalHref = `${window.location.origin}/epl/${SEASON_PATH}/matchweek/${round}/`;
  let canon = document.querySelector('link[rel="canonical"]');
  if (!canon) {
    canon = document.createElement("link");
    canon.setAttribute("rel", "canonical");
    document.head.appendChild(canon);
  }
  canon.setAttribute("href", canonicalHref);
}

const renderEventText = createRenderEventText(esc, players);
const renderEventRow = createRenderEventRow(esc, renderEventText);
const renderMatchCard = createRenderMatchCard({
  esc,
  teamsById: teams,
  seasonPath: SEASON_PATH,
  // playersById: players,
  sortedEvents,
  isVisibleInMode,          // the shared one you already import
  renderEventRow,
  getModeForMatchId: (matchId) => viewModes.get(matchId) ?? VIEW_MODES.COMPACT
});

let currentRound = null;
let currentMatches = [];
let globalViewMode = VIEW_MODES.FULL; // start compact like you want
let statsShown = true;
let liveCurrentRound = null;
let livePublishedAtMs = null;
let autoUpdateTimer = null;
let autoUpdateInFlight = false;

function readAutoUpdatePreference() {
  try {
    return window.localStorage.getItem(AUTO_UPDATE_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

let autoUpdateEnabled = readAutoUpdatePreference();

const viewModes = new Map();

const app = document.querySelector("#app");

function updateSeasonChrome() {
  const tagline = document.querySelector(".site-tagline");
  if (tagline) {
    tagline.textContent = `${season.leagueName} ${SEASON_LABEL}`;
  }

  document.querySelectorAll('.page-nav a[href^="/epl/"]').forEach((link) => {
    const href = link.getAttribute("href") || "";
    link.setAttribute("href", href.replace(/\/epl\/\d{4}-\d{2}\//, `/epl/${SEASON_PATH}/`));
  });
}

function renderAllMatches() {

  const app = document.querySelector("#app");
  if (!app) return;

  app.innerHTML = `
    <div class="match-list">
      ${currentMatches.map(renderMatchCard).join("")}
    </div>
  `;
}

let showAllAriaPressed = "false";
let roundName = "MW"; // keep your variable

function renderControls() {

  const matchdaySelect = document.querySelector("#matchday-select");
  const showAllBtn = document.querySelector("#show-all-timelines");
  const roundLabel = document.querySelector("#round-label");

  // If we're on a page without these controls, just no-op.
  if (!matchdaySelect || !showAllBtn || !roundLabel) return;
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

const statsToggleBtn = document.getElementById("show-stats");

if (statsToggleBtn) {
  applyStatsVisibility();

  statsToggleBtn.addEventListener("click", () => {
    statsShown = !statsShown;
    applyStatsVisibility();
  });
}

function applyStatsVisibility() {
  document.querySelectorAll(".power-meter").forEach((el) => {
    el.hidden = !statsShown;
  });

  const btn = document.getElementById("show-stats");
  if (btn) {
    btn.setAttribute("aria-pressed", statsShown ? "true" : "false");
    btn.textContent = statsShown ? "Hide Stats" : "Show Stats";
  }
}

function isAutoUpdateAvailable() {
  const activeRound = liveCurrentRound ?? pickCurrentRoundByCompletion(MATCHDAYS);
  return (
    !season.isArchived &&
    Number.isInteger(activeRound) &&
    currentRound === activeRound
  );
}

function setAutoUpdateStatus(text = "") {
  const status = document.getElementById("auto-update-status");
  if (status) status.textContent = text;
}

function updateAutoUpdateControl() {
  const container = document.getElementById("auto-update-container");
  const toggle = document.getElementById("auto-update-toggle");
  if (!container || !toggle) return;

  const available = isAutoUpdateAvailable();
  container.hidden = !available;
  toggle.checked = autoUpdateEnabled;

  if (!available && autoUpdateTimer) {
    window.clearTimeout(autoUpdateTimer);
    autoUpdateTimer = null;
  }
}

function getNextAutoUpdateDelay(nowMs = Date.now()) {
  const now = new Date(nowMs);

  for (const minute of AUTO_UPDATE_MINUTES_UTC) {
    const target = new Date(nowMs);
    target.setUTCMinutes(minute, 0, 0);
    if (target.getTime() > nowMs + 1000) return target.getTime() - nowMs;
  }

  const nextHour = new Date(nowMs);
  nextHour.setUTCHours(now.getUTCHours() + 1, AUTO_UPDATE_MINUTES_UTC[0], 0, 0);
  return nextHour.getTime() - nowMs;
}

function getMatchRefreshWindow(nowMs = Date.now()) {
  const matches = MATCHDAYS[currentRound]?.matches || [];
  let nextWindowStart = null;

  for (const match of matches) {
    const kickoffMs = Date.parse(match?.kickoff || "");
    if (!Number.isFinite(kickoffMs)) continue;

    const windowStart = kickoffMs - MATCH_WINDOW_BEFORE_MS;
    const windowEnd = kickoffMs + MATCH_WINDOW_AFTER_MS;

    if (nowMs >= windowStart && nowMs <= windowEnd) {
      return { active: true, nextWindowStart: null };
    }

    if (windowStart > nowMs && (nextWindowStart == null || windowStart < nextWindowStart)) {
      nextWindowStart = windowStart;
    }
  }

  return { active: false, nextWindowStart };
}

function scheduleAutoUpdate() {
  if (autoUpdateTimer) window.clearTimeout(autoUpdateTimer);
  autoUpdateTimer = null;

  if (!autoUpdateEnabled || !isAutoUpdateAvailable()) return;

  const matchWindow = getMatchRefreshWindow();
  if (!matchWindow.active) {
    if (matchWindow.nextWindowStart != null) {
      autoUpdateTimer = window.setTimeout(
        scheduleAutoUpdate,
        Math.max(1000, matchWindow.nextWindowStart - Date.now())
      );
    }
    return;
  }

  autoUpdateTimer = window.setTimeout(
    refreshLiveMatchday,
    getNextAutoUpdateDelay()
  );
}

async function refreshLiveMatchday() {
  if (autoUpdateInFlight || !autoUpdateEnabled || !isAutoUpdateAvailable()) {
    scheduleAutoUpdate();
    return;
  }

  if (!getMatchRefreshWindow().active) {
    scheduleAutoUpdate();
    return;
  }

  autoUpdateInFlight = true;
  setAutoUpdateStatus("Checking...");

  try {
    const result = await loadLiveCurrentMatchday();
    if (!result) {
      setAutoUpdateStatus("Retrying later");
      return;
    }

    if (result.round === currentRound && result.changed) {
      currentMatches = attachMatchData(MATCHDAYS[currentRound].matches, currentRound);
      for (const match of currentMatches) {
        const id = String(match.id);
        if (!viewModes.has(id)) viewModes.set(id, globalViewMode);
      }
      renderAllMatches();
      applyStatsVisibility();
    }

    const updatedTime = new Date(livePublishedAtMs).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
    setAutoUpdateStatus(`Updated ${updatedTime}`);
  } finally {
    autoUpdateInFlight = false;
    updateAutoUpdateControl();
    scheduleAutoUpdate();
  }
}

function setAutoUpdateEnabled(enabled) {
  autoUpdateEnabled = enabled;

  try {
    window.localStorage.setItem(AUTO_UPDATE_STORAGE_KEY, String(enabled));
  } catch {
    // The preference remains active for this page when storage is unavailable.
  }

  updateAutoUpdateControl();

  if (enabled) {
    refreshLiveMatchday();
  } else {
    if (autoUpdateTimer) window.clearTimeout(autoUpdateTimer);
    autoUpdateTimer = null;
    setAutoUpdateStatus("");
  }
}

document.getElementById("auto-update-toggle")?.addEventListener("change", (event) => {
  setAutoUpdateEnabled(event.currentTarget.checked);
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && autoUpdateEnabled && isAutoUpdateAvailable()) {
    refreshLiveMatchday();
  }
});

async function init() {
  updateSeasonChrome();

  await loadAllMatchdays();
  await Promise.all([loadLiveCurrentMatchday(), loadOdds()]);

  const allRounds = Object.keys(MATCHDAYS)
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (!allRounds.length) {
    app.innerHTML = `<div class="match-list"><p>No matchday data found.</p></div>`;
    return;
  }

  const routeRound = getRoundFromPathname();

  // const initialRound =
  //   (routeRound && MATCHDAYS[routeRound] ? routeRound : null) ??
  //   pickInitialRound(MATCHDAYS) ??
  //   allRounds[allRounds.length - 1];

  const initialRound =
    (routeRound && MATCHDAYS[routeRound] ? routeRound : null) ??
    pickCurrentRoundByCompletion(MATCHDAYS) ??
    allRounds[allRounds.length - 1];


  currentRound = initialRound;
  setPageMetaForRound(currentRound);

  updateHeaderNav(currentRound);

  currentRound = initialRound;

  // Root "/" is an entry point only.
  // Must hard-navigate to prerendered matchweek HTML so nav exists.

  if (window.location.pathname === "/") {
    // ... after currentRound is computed and validated
    window.location.replace(`/epl/${SEASON_PATH}/matchweek/current/`);
    return;
  }

  // HARD GUARD (do not proceed if round is invalid)
  if (!Number.isFinite(currentRound)) {
    throw new Error(`Invalid currentRound: ${currentRound}`);
  }

  currentMatches = attachMatchData(MATCHDAYS[currentRound].matches, currentRound);

  // initialize per-card modes to match the global mode
  viewModes.clear();
  for (const m of currentMatches) viewModes.set(String(m.id), globalViewMode);

  renderControls();
  renderAllMatches();
  applyStatsVisibility();
  updateAutoUpdateControl();
  scheduleAutoUpdate();
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
    applyStatsVisibility();
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
  applyStatsVisibility();
});

document.addEventListener("change", (e) => {
  const select = e.target.closest("#matchday-select");
  if (!select) return;

  const nextRound = Number(select.value);
  if (!MATCHDAYS[nextRound]) return;

  currentRound = nextRound;
  currentMatches = attachMatchData(MATCHDAYS[currentRound].matches, currentRound);

  updateHeaderNav(currentRound);

  // reset global + per-card state for the new matchday
  globalViewMode = VIEW_MODES.FULL;
  showAllAriaPressed = "false";

  history.replaceState(null, "", `/epl/${SEASON_PATH}/matchweek/${currentRound}/`);
  setPageMetaForRound(currentRound);


  viewModes.clear();
  for (const m of currentMatches) viewModes.set(String(m.id), globalViewMode);

  // re-render with the new round's matches
  renderControls();
  renderAllMatches();
  applyStatsVisibility();
  updateAutoUpdateControl();
  scheduleAutoUpdate();
});
