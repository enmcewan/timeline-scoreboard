// src/lib/apiFootballEvents.js
import { minuteToNumber } from "./utils.js";

// Turn elapsed/extra into "25'" or "45'+2"
export function formatMinute(elapsed, extra) {
  if (elapsed == null) return "";

  const base = Number(elapsed);
  if (!Number.isFinite(base)) return "";

  if (extra == null) {
    return `${base}'`;
  }

  const extraNum = Number(extra);
  if (!Number.isFinite(extraNum)) {
    return `${base}'`;
  }

  return `${base}'+${extraNum}`;
}

// Normalize API-Football (type, detail) into your kind + detail
export function mapEventKindAndDetail(type, detail) {
  const t = (type || "").toLowerCase();
  const d = (detail || "").toLowerCase();

  // Goals
  if (t === "goal") {
    if (d.includes("own")) {
      return { kind: "own-goal", detail: "og" };
    }
    if (d.includes("penalty")) {
      // "Penalty" or "Missed Penalty"
      if (d.includes("missed")) {
        return { kind: "penalty-miss", detail: "missed pen" };
      }
      return { kind: "goal", detail: "pen" };
    }
    // Normal goal
    return { kind: "goal", detail: "" };
  }

  // VAR
  if (t === "var") {
    if (d.includes("goal cancelled")) {
      return { kind: "var-goal-cancelled", detail: "goal cancelled (VAR)" };
    }
    if (d.includes("penalty confirmed")) {
      // not useful for our UI – treat as non-event
      return null;
    }
  }

  // Cards
  if (t === "card") {
    if (d.includes("second") && d.includes("yellow")) {
      return { kind: "second-yellow", detail: "" };
    }
    if (d.includes("yellow")) {
      return { kind: "yellow", detail: "" };
    }
    if (d.includes("red")) {
      return { kind: "red", detail: "" };
    }
  }

  // Substitutions
  if (t === "subst") {
    return { kind: "sub", detail: "" };
  }

  // VAR & other stuff you might want later
  if (t === "var") {
    return { kind: "var", detail: detail || "" };
  }

  // Fallback
  return { kind: "other", detail: detail || "" };
}

/**
 * Map API-Football events into your internal Event[].
 *
 * @param {Array} apiEvents - raw events from /fixtures/events
 * @param {number} homeApiTeamId - numeric team id from API for home team
 * @param {number} awayApiTeamId - numeric team id from API for away team
 * @param {number|string} fixtureId - fixture id, used for deterministic event ids
 * @returns {Array} normalized events
 */

export function mapEventsFromApi(apiEvents, homeApiTeamId, awayApiTeamId, fixtureId) {
  if (!Array.isArray(apiEvents)) return [];

  return apiEvents.map((e, index) => {
    const minute = formatMinute(e.time?.elapsed, e.time?.extra);

    let team = "home";
    if (e.team?.id === awayApiTeamId) team = "away";
    // if it's neither, we still default to "home" – but you could mark it "other" if you want

    const { kind, detail } = mapEventKindAndDetail(e.type, e.detail);

    // subs: player = in, assist = out (per API-Football convention)
    const playerName = e.player?.name || "";
    const assistName = e.assist?.name || "";

    let inPlayer = undefined;
    let outPlayer = undefined;

    if (kind === "sub") {
      inPlayer = assistName;
      outPlayer = playerName;
    }

    return {
      id: `${fixtureId}-${index}`,   // stable, deterministic id
      minute,
      team,
      kind,                          // normalized type
      player: playerName,
      assist: kind === "sub" ? undefined : assistName,
      inPlayer,
      outPlayer,
      detail: detail || undefined,
      rawType: e.type || "",
      rawDetail: e.detail || ""
    };
  });
}

// Optional: a helper if you ever want them sorted immediately
export function mapAndSortEvents(apiEvents, homeApiTeamId, awayApiTeamId, fixtureId) {
  const mapped = mapEventsFromApi(apiEvents, homeApiTeamId, awayApiTeamId, fixtureId);
  return mapped.sort((a, b) => minuteToNumber(a.minute) - minuteToNumber(b.minute));
}
