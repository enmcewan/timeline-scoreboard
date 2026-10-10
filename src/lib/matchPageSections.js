function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function downloadImageIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M11 3h2v10.2l3.6-3.6 1.4 1.4-6 6-6-6 1.4-1.4 3.6 3.6V3Zm-6 16h14v2H5v-2Z"/>
  </svg>`;
}

export function downloadImageButton({ label, filename, target = "section" }) {
  return `<button
    class="match-page-export-button"
    type="button"
    data-download-image
    data-download-target="${escapeHtml(target)}"
    data-download-filename="${escapeHtml(filename)}"
    aria-label="${escapeHtml(label)}"
    title="${escapeHtml(label)}"
  >${downloadImageIcon()}<span class="sr-only">${escapeHtml(label)}</span></button>`;
}

export function buildMatchInsightsHtml(match, home, away, exportBase) {
  const insights = match.insights || {};
  const definitions = [
    ["bigChances", "Big chances"],
    ["bigChancesMissed", "Big chances missed"],
    ["hitWoodwork", "Hit the woodwork"],
    ["tackles", "Total tackles"],
    ["accuratePasses", "Accurate passes"],
    ["duelsWonPct", "Duels won", true],
    ["offsides", "Offsides"],
    ["interceptions", "Interceptions"],
    ["clearances", "Clearances"],
    ["goalkeeperSaves", "Goalkeeper saves"],
  ];
  const formatValue = (value, percent) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    const formatted = Number.isInteger(number) ? String(number) : number.toFixed(1);
    return percent ? `${formatted}%` : formatted;
  };
  const rows = definitions.map(([key, label, percent = false]) => {
    const homeValue = formatValue(insights[key]?.home, percent);
    const awayValue = formatValue(insights[key]?.away, percent);
    if (homeValue == null || awayValue == null) return "";

    return `
      <tr>
        <td class="match-insights__value">${escapeHtml(homeValue)}</td>
        <th scope="row">${escapeHtml(label)}</th>
        <td class="match-insights__value">${escapeHtml(awayValue)}</td>
      </tr>
    `;
  }).filter(Boolean).join("");

  if (!rows) return "";

  return `
    <section class="match-page-section match-page-insights">
      <div class="match-page-section-heading">
        <h2>Match Insights</h2>
        ${downloadImageButton({
          label: "Download Match Insights image",
          filename: `${exportBase}-match-insights.png`,
        })}
      </div>
      <table class="match-insights">
        <thead>
          <tr>
            <th scope="col">${escapeHtml(home.display || home.name)}</th>
            <th scope="col">Metric</th>
            <th scope="col">${escapeHtml(away.display || away.name)}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
  `;
}

function shotMapLabel(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function shotMapResult(shot) {
  const result = String(shot?.result || "").toLowerCase();
  if (shot?.isGoal || result === "goal") return { key: "goal", label: "Goal" };
  if (result === "post" || result === "woodwork") return { key: "post", label: "Hit the woodwork" };
  if (shot?.isBlocked || result === "block" || result === "blocked") return { key: "block", label: "Blocked" };
  if (shot?.isOnTarget || result === "save" || result === "saved") return { key: "save", label: "Saved" };
  return { key: "miss", label: "Off target" };
}

export function buildShotMapHtml(match, home, away, exportBase) {
  const shots = Array.isArray(match?.shotMap?.shots) ? match.shotMap.shots : [];
  if (!shots.length) return "";

  const goalEvents = (match.events || []).filter((event) =>
    event?.kind === "goal" && event?.assist
  );
  const assistForShot = (shot) => {
    if (!shot?.isGoal && String(shot?.result || "").toLowerCase() !== "goal") return "";
    const minute = Number(shot.minute);
    if (!Number.isFinite(minute)) return "";
    const event = goalEvents.find((candidate) =>
      candidate.team === shot.side && Number(candidate.elapsed) === minute
    );
    return event?.assist || "";
  };

  const validShots = shots.filter((shot) =>
    ["home", "away"].includes(shot?.side) &&
    Number.isFinite(Number(shot?.x)) &&
    Number.isFinite(Number(shot?.y))
  );
  if (!validShots.length) return "";

  const teamStats = {
    home: { team: home, shots: 0, xg: 0 },
    away: { team: away, shots: 0, xg: 0 },
  };
  validShots.forEach((shot) => {
    const xg = Number(shot.xg);
    teamStats[shot.side].shots += 1;
    if (Number.isFinite(xg)) teamStats[shot.side].xg += xg;
  });

  const markers = validShots
    .slice()
    .sort((a, b) => Number(Boolean(a.isGoal)) - Number(Boolean(b.isGoal)))
    .map((shot) => {
      const result = shotMapResult(shot);
      const xg = Number(shot.xg);
      const minute = Number.isFinite(Number(shot.minute)) ? `${Number(shot.minute)}'` : "";
      const assist = assistForShot(shot);
      const situation = assist && shot.situation === "assisted" ? "" : shot.situation;
      const details = [
        minute,
        shot.playerName || "Unknown player",
        result.label,
        assist ? `Assist: ${assist}` : "",
        Number.isFinite(xg) ? `${xg.toFixed(2)} xG` : "",
        situation ? shotMapLabel(situation) : "",
        shot.bodyPart ? shotMapLabel(shot.bodyPart) : "",
      ].filter(Boolean).join(" · ");
      const left = Math.max(2, Math.min(98, Number(shot.y)));
      const top = Math.max(2, Math.min(98, Number(shot.x) * 2));
      const size = Number.isFinite(xg)
        ? Math.max(11, Math.min(25, 11 + Math.sqrt(Math.max(0, xg)) * 15))
        : 11;

      return `<button
        class="shot-map__shot shot-map__shot--${shot.side} shot-map__shot--${result.key}"
        type="button"
        style="--shot-left:${left.toFixed(2)}%;--shot-top:${top.toFixed(2)}%;--shot-size:${size.toFixed(1)}px"
        data-shot-side="${shot.side}"
        data-shot-description="${escapeHtml(details)}"
        aria-label="${escapeHtml(details)}"
        aria-pressed="false"
        title="${escapeHtml(details)}"
      ><span class="sr-only">${escapeHtml(details)}</span></button>`;
    }).join("");

  const teamSummary = (side) => {
    const item = teamStats[side];
    const name = item.team.display || item.team.name;
    return `<button
      class="shot-map__team shot-map__team--${side}"
      type="button"
      data-shot-team="${side}"
      data-team-name="${escapeHtml(name)}"
      aria-label="Hide ${escapeHtml(name)} shots"
      aria-pressed="true"
    >
      <span class="shot-map__team-name">${escapeHtml(name)}</span>
      <span>${item.shots} shots · ${item.xg.toFixed(2)} xG</span>
    </button>`;
  };

  return `
    <section class="match-page-section match-page-shot-map">
      <div class="match-page-section-heading">
        <h2>Shot Map</h2>
        ${downloadImageButton({
          label: "Download Shot Map image",
          filename: `${exportBase}-shot-map.png`,
        })}
      </div>
      <div class="shot-map__teams">
        ${teamSummary("home")}
        ${teamSummary("away")}
      </div>
      <div class="shot-map__pitch" role="group" aria-label="Shot locations toward goal">
        <span class="shot-map__six-yard" aria-hidden="true"></span>
        <span class="shot-map__penalty-area" aria-hidden="true"></span>
        <span class="shot-map__penalty-spot" aria-hidden="true"></span>
        <span class="shot-map__penalty-arc" aria-hidden="true">
          <span class="shot-map__penalty-arc-circle"></span>
        </span>
        <span class="shot-map__halfway" aria-hidden="true"></span>
        ${markers}
      </div>
      <div class="shot-map__legend" aria-label="Shot map legend">
        <span><i class="shot-map__key shot-map__key--goal"></i>Goal</span>
        <span><i class="shot-map__key shot-map__key--save"></i>Saved</span>
        <span><i class="shot-map__key shot-map__key--block"></i>Blocked</span>
        <span><i class="shot-map__key shot-map__key--miss"></i>Off target</span>
        <span><i class="shot-map__key shot-map__key--post"></i>Woodwork</span>
        <span class="shot-map__size-note">Marker size = xG</span>
      </div>
      <p class="shot-map__detail" aria-live="polite">Select a shot for details</p>
    </section>
  `;
}

export function buildMatchPageSectionsHtml(match, home, away, exportBase) {
  return [
    buildMatchInsightsHtml(match, home, away, exportBase),
    buildShotMapHtml(match, home, away, exportBase),
  ].filter(Boolean).join("\n");
}
