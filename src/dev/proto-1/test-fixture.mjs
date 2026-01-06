import fixtureJson from "../data/dev/sample.fixture.json" with { type: "json" };
import eventsJson from "../data/dev/sample.events.json" with { type: "json" };
import { mapFixtureToMatch } from "../lib/apiFootballFixture.js";

const apiFixture = fixtureJson.response[0];
const apiEvents = eventsJson.response;

// In this sample, API team ids are 967 and 968.
// But mapFixtureToMatch already knows how to derive the slugs and
// passes those ids into mapAndSortEvents, so we just call it.
const match = mapFixtureToMatch(apiFixture, apiEvents);

console.log("Normalized match object:\n");
console.dir(match, { depth: null });

console.log("\nEvents timeline:");
for (const evt of match.events) {
  console.log(
    `${(evt.minute || "").padEnd(6)}  ${evt.team.padEnd(5)}  ${evt.kind.padEnd(12)}  ${evt.player || ""} ${
      evt.detail ? "(" + evt.detail + ")" : ""
    }`
  );
}
