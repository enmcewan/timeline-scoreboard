export const SEASONS = {
  "2025-26": {
    leagueKey: "epl",
    leagueName: "English Premier League",
    leagueShortName: "EPL",
    apiLeagueId: 39,
    apiSeason: 2025,
    seasonPath: "2025-26",
    seasonLabel: "2025-26",
    displaySeasonLabel: "2025-26",
    sourceDataSeason: "2025",
    maxRound: 38,
    isArchived: true,
  },
  "2026-27": {
    leagueKey: "epl",
    leagueName: "English Premier League",
    leagueShortName: "EPL",
    apiLeagueId: 39,
    apiSeason: 2026,
    seasonPath: "2026-27",
    seasonLabel: "2026-27",
    displaySeasonLabel: "2026-27",
    sourceDataSeason: "2026",
    maxRound: 38,
    isArchived: false,
  },
};

export const ACTIVE_SEASON_PATH = "2026-27";
export const PRERENDER_SEASON_PATHS = ["2025-26", "2026-27"];

export function getSeasonConfig(seasonPath = ACTIVE_SEASON_PATH) {
  const config = SEASONS[seasonPath];
  if (!config) {
    throw new Error(`Unknown season path: ${seasonPath}`);
  }
  return config;
}

export function getActiveSeasonConfig() {
  return getSeasonConfig(ACTIVE_SEASON_PATH);
}

export function getSeasonConfigFromPathname(pathname = "") {
  const match = String(pathname).match(/\/epl\/(\d{4}-\d{2})(?:\/|$)/);
  return match ? getSeasonConfig(match[1]) : getActiveSeasonConfig();
}

export function getSeasonConfigFromEnv() {
  return getSeasonConfig(process.env.TIMELINE_SEASON || ACTIVE_SEASON_PATH);
}

export function publicSeasonDataPath(config) {
  return ["data", "leagues", config.leagueKey, config.seasonPath].join("/");
}

export function sourceSeasonDataPath(config) {
  return ["data", "leagues", config.leagueKey, config.sourceDataSeason].join("/");
}
