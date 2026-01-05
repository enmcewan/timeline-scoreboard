// src/dev/build-sample-match.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import fixtureRaw from "../data/dev/fixture.raw.json" with { type: "json" };
import { mapFixtureToMatch } from "../lib/apiFootballFixture.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");

function writeJson(relativePath, data) {
  const full = path.join(projectRoot, relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(data, null, 2), "utf8");
  console.log(`Wrote: ${full}`);
}

function main() {
  const apiFixture = fixtureRaw.response?.[0];

  if (!apiFixture) {
    throw new Error("fixture.raw.json: no response[0] found");
  }

  // Adjust this path if your JSON nests events slightly differently
  const apiEvents = apiFixture.events || [];

  const match = mapFixtureToMatch(apiFixture, apiEvents);

  // Overwrite the match your UI is using
  writeJson("src/data/leagues/epl/match.sample.json", match);

  console.log("Normalized match:");
  console.dir(match, { depth: null });
}

main();
