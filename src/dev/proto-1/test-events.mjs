import eventsJson from "../data/dev/sample.events.json" with { type: "json" };
import { mapAndSortEvents } from "../lib/apiFootballEvents.js";

const fixtureId = 215662; // matches your sample JSON
const apiEvents = eventsJson.response;

// These are from the sample:
// Aldosivi = 463 (home in your sample)
// Defensa y Justicia = 442 (away)
const HOME = 463;
const AWAY = 442;

const mapped = mapAndSortEvents(apiEvents, HOME, AWAY, fixtureId);

console.log("Mapped Events:");
console.log(mapped);

// Nice readable output
for (const evt of mapped) {
  console.log(
    `${evt.minute.padEnd(6)}  ${evt.team.padEnd(5)}  ${evt.kind.padEnd(12)}  ${evt.player || ""} ${evt.detail ? "(" + evt.detail + ")" : ""}`
  );
}
