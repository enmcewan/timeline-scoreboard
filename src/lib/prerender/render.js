import { esc, sortedEvents } from "../utils.js";
import { VIEW_MODES, isVisibleInMode, createRenderEventText, createRenderEventRow, createRenderMatchCard } from "../sharedRenderer.js";

/**
 * Render a full matchweek into HTML.
 * This must be Node-safe: no DOM access, no document/window.
 */
export function renderMatchweekHTML({ matches, teams, players = {}, seasonPath, globalMode = "compact" }) {
  const viewModes = new Map(matches.map((m) => [String(m.id), globalMode]));
  const renderEventText = createRenderEventText(esc, players);
  const renderEventRow = createRenderEventRow(esc, renderEventText);
  const renderMatchCard = createRenderMatchCard({
    esc,
    teamsById: teams,
    seasonPath,
    sortedEvents,
    isVisibleInMode,
    renderEventRow,
    getModeForMatchId: () => VIEW_MODES.FULL
  });

  return `
    <div class="match-list">
      ${matches.map((m) => renderMatchCard(m, teams, viewModes.get(String(m.id)))).join("")}
    </div>
  `;
}
