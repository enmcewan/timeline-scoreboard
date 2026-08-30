export function matchSlug(homeTeamId, awayTeamId) {
  return `${homeTeamId}-v-${awayTeamId}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function getMatchPagePath({ seasonPath, round, homeTeamId, awayTeamId }) {
  const roundNum = Number(round);
  if (!seasonPath || !Number.isFinite(roundNum) || !homeTeamId || !awayTeamId) {
    return null;
  }

  return `/epl/${seasonPath}/matchweek/${roundNum}/${matchSlug(homeTeamId, awayTeamId)}/`;
}
