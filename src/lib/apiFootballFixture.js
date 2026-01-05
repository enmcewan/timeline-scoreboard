// src/lib/apiFootballFixture.js
import { mapAndSortEvents } from "./apiFootballEvents.js";

// You can later move this to a JSON config.
// For now, just an example shape for EPL:
const apiTeamIdToSlug = {
  // [apiTeamId]: "your-team-slug"
  // 42: "arsenal",
  // 50: "man-city",
};

/**
 * Resolve your internal team slug from API-Football team object.
 * If missing in the map, we fall back to a slug from the name.
 */
function teamSlugFromApi(team) {
  if (!team) return "";

  const mapped = apiTeamIdToSlug[team.id];
  if (mapped) return mapped;

  // Fallback: naive slug from name
  return String(team.name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/**
 * Build a stable match id from date + slugs.
 */
function makeMatchId({ date, homeSlug, awaySlug }) {
  const d = (date || "").slice(0, 10); // YYYY-MM-DD
  return `${d}-${homeSlug}-${awaySlug}`;
}

/**
 * Map API-Football fixture+events into your internal `match` shape.
 *
 * @param {object} apiFixture - one element from /fixtures response
 * @param {Array} apiEvents - array from /fixtures/events (matching fixture.id)
 * @returns {object} normalized match
 */
export function mapFixtureToMatch(apiFixture, apiEvents = []) {
  const { fixture, league, teams, goals, score } = apiFixture;

  const homeTeam = teams.home;
  const awayTeam = teams.away;

  const homeSlug = teamSlugFromApi(homeTeam);
  const awaySlug = teamSlugFromApi(awayTeam);

  const matchId = makeMatchId({
    date: fixture.date,
    homeSlug,
    awaySlug,
  });

  // score
  const finalHome = goals?.home ?? 0;
  const finalAway = goals?.away ?? 0;

  // halftime
  const htHome = score?.halftime?.home;
  const htAway = score?.halftime?.away;
  const halfTimeScore =
    htHome != null && htAway != null ? `${htHome}–${htAway}` : "";

  // status – for finished seasons you care mostly about FT
  const state = fixture.status?.short || ""; // "HT", "FT", "1H", etc.

  // events
  const events = mapAndSortEvents(
    apiEvents,
    homeTeam.id,
    awayTeam.id,
    fixture.id
  );

  return {
    id: matchId,
    league: league.name,                        // e.g. "Premier League"
    venue: fixture.venue?.name || "",
    attendance: null,                           // API-Football doesn't provide it here
    kickoff: fixture.date,                      // ISO-like string

    homeTeamId: homeSlug,
    awayTeamId: awaySlug,

    score: {
      home: finalHome,
      away: finalAway,
    },

    status: {
      state,
      halfTimeScore,
    },

    events,
  };
}
