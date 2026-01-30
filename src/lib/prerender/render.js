import { esc, sortedEvents } from "../utils.js";
import { VIEW_MODES, isVisibleInMode, createRenderEventText, createRenderEventRow, createRenderMatchCard } from "../sharedRenderer.js";
import teams from "../../data/leagues/epl/2025/teams.json" with { type: "json" };

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

const renderEventText = createRenderEventText(esc);
const renderEventRow = createRenderEventRow(esc, renderEventText);
const renderMatchCard = createRenderMatchCard({
  esc,
  teamsById: teams,
  sortedEvents,
  isVisibleInMode,
  renderEventRow,
  getModeForMatchId: () => VIEW_MODES.FULL
});