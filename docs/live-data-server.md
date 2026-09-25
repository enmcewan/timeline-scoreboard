# Live Data Server

This is the standalone updater for serving fresh Timeline Football JSON from `lauris-webdev.com` while keeping the main site on Netlify.

API-Football remains the source for fixtures, scores, match statistics, and the
detailed event timeline. TheStatsAPI supplies the authoritative live and
finalized xG values used by pX, eX, Rating, and season charts.

## Output

By default the updater writes to:

```text
live-data/
```

For production, set `LIVE_DATA_OUT_DIR` to a web-served folder on the hosted server, for example:

```text
/home/<account>/public_html/timeline-data
```

Expected public URLs:

```text
https://lauris-webdev.com/timeline-data/epl/2026-27/health.json
https://lauris-webdev.com/timeline-data/epl/2026-27/matchweeks/current.json
https://lauris-webdev.com/timeline-data/epl/2026-27/matchweeks/4.json
```

The publisher writes an `.htaccess` file with:

```text
Access-Control-Allow-Origin: https://timelinefootball.com
Cache-Control: public, max-age=60
Content-Type: application/json
```

## Local Test

Use the same API key environment variable as the current GitHub Action:

```bash
export APIFOOTBALL_KEY="..."
export TSAPI_KEY="..."
export TIMELINE_SEASON="2026-27"
export LIVE_DATA_OUT_DIR="./live-data"
npm run live:update
```

On Windows Command Prompt:

```bat
set APIFOOTBALL_KEY=...
set TSAPI_KEY=...
set TIMELINE_SEASON=2026-27
set LIVE_DATA_OUT_DIR=live-data
npm run live:update
```

## Server Cron

Run four times per hour, offset to better capture stoppage time for the usual
on-the-hour and half-hour kickoffs:

```cron
3,18,33,51 * * * * cd /home/<account>/timeline-scoreboard && APIFOOTBALL_KEY="..." TSAPI_KEY="..." TIMELINE_SEASON="2026-27" LIVE_DATA_OUT_DIR="/home/<account>/public_html/timeline-data" /usr/bin/npm run live:update >> /home/<account>/timeline-scoreboard/live-update.log 2>&1
```

If the host has Node but not npm on the cron path, use the full paths from the hosting control panel.

The cron process is schedule-gated before any API request. It performs the full
update only from 10 minutes before a cached fixture's kickoff until 195 minutes
after kickoff. Outside that window it exits successfully without calling either
provider. Set `FORCE_REFRESH=1` only for a deliberate manual override.

TheStatsAPI fixture IDs and the last valid xG values are cached in the ignored
`thestatsapi-xg.json` season file. Only xG is overlaid on the match data;
API-Football's richer timeline events and all other statistics remain intact.
Live fixtures use TheStatsAPI's `live-stats` endpoint. Finished fixtures and the
scheduled backfill use `stats`, so the final match values replace the cached
live values once available.

## Integration Plan

1. Confirm `health.json` updates every 15 minutes.
2. Confirm `matchweeks/current.json` has the same match objects as Netlify data.
3. Add frontend fallback:
   - try `https://lauris-webdev.com/timeline-data/epl/2026-27/matchweeks/current.json`
   - fall back to bundled Netlify JSON.
4. Keep GitHub/Netlify for the daily static rebuild, sitemap, IndexNow,
   standings, odds, finalized xG backfill, and missing player profiles. The daily rebuild
   overlays the current Lauris matchweek without repeating the live fixture,
   event, odds, or standings API requests.
