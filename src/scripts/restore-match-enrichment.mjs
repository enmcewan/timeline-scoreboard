import fs from "node:fs/promises";
import path from "node:path";

const [sourceDirArg, targetDirArg] = process.argv.slice(2);

if (!sourceDirArg || !targetDirArg) {
  throw new Error(
    "Usage: node src/scripts/restore-match-enrichment.mjs <source-matchweeks-dir> <target-matchweeks-dir>",
  );
}

const sourceDir = path.resolve(sourceDirArg);
const targetDir = path.resolve(targetDirArg);

function parseJson(text, label) {
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

function hasValue(value) {
  return value !== null && value !== undefined && value !== "";
}

function mergeObject(source, target) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return target === undefined ? source : target;
  }

  const result = { ...source };
  for (const [key, targetValue] of Object.entries(target || {})) {
    const sourceValue = source[key];
    result[key] =
      sourceValue &&
      targetValue &&
      typeof sourceValue === "object" &&
      typeof targetValue === "object" &&
      !Array.isArray(sourceValue) &&
      !Array.isArray(targetValue)
        ? mergeObject(sourceValue, targetValue)
        : targetValue;
  }
  return result;
}

function restoreXg(sourceMatch, targetMatch) {
  const sourceStats = sourceMatch?.statistics;
  if (sourceStats?.xgProvider !== "thestatsapi") return false;

  const sourceHomeXg = sourceStats.home?.xg;
  const sourceAwayXg = sourceStats.away?.xg;
  if (!hasValue(sourceHomeXg) || !hasValue(sourceAwayXg)) return false;

  targetMatch.statistics ||= {};
  targetMatch.statistics.home ||= {};
  targetMatch.statistics.away ||= {};

  const targetUsesTheStatsApi = targetMatch.statistics.xgProvider === "thestatsapi";
  let changed = false;

  if (!targetUsesTheStatsApi || !hasValue(targetMatch.statistics.home.xg)) {
    if (hasValue(sourceHomeXg) && targetMatch.statistics.home.xg !== sourceHomeXg) {
      targetMatch.statistics.home.xg = sourceHomeXg;
      changed = true;
    }
  }

  if (!targetUsesTheStatsApi || !hasValue(targetMatch.statistics.away.xg)) {
    if (hasValue(sourceAwayXg) && targetMatch.statistics.away.xg !== sourceAwayXg) {
      targetMatch.statistics.away.xg = sourceAwayXg;
      changed = true;
    }
  }

  if (
    hasValue(targetMatch.statistics.home.xg) &&
    hasValue(targetMatch.statistics.away.xg) &&
    targetMatch.statistics.xgProvider !== "thestatsapi"
  ) {
    targetMatch.statistics.xgProvider = "thestatsapi";
    changed = true;
  }

  return changed;
}

function restoreInsights(sourceMatch, targetMatch) {
  if (sourceMatch?.insights?.provider !== "thestatsapi") return false;

  const targetInsights =
    targetMatch?.insights?.provider === "thestatsapi" ? targetMatch.insights : undefined;
  const merged = mergeObject(sourceMatch.insights, targetInsights);
  const before = JSON.stringify(targetMatch.insights);
  const after = JSON.stringify(merged);
  if (before === after) return false;

  targetMatch.insights = merged;
  return true;
}

function restoreShotMap(sourceMatch, targetMatch) {
  const sourceShotMap = sourceMatch?.shotMap;
  if (
    sourceShotMap?.provider !== "thestatsapi" ||
    !Array.isArray(sourceShotMap.shots) ||
    sourceShotMap.shots.length === 0
  ) {
    return false;
  }

  if (
    targetMatch?.shotMap?.provider === "thestatsapi" &&
    Array.isArray(targetMatch.shotMap.shots) &&
    targetMatch.shotMap.shots.length > 0
  ) {
    return false;
  }

  targetMatch.shotMap = sourceShotMap;
  return true;
}

function restoreMatch(sourceMatch, targetMatch) {
  return [
    restoreXg(sourceMatch, targetMatch),
    restoreInsights(sourceMatch, targetMatch),
    restoreShotMap(sourceMatch, targetMatch),
  ].some(Boolean);
}

async function main() {
  const sourceFiles = (await fs.readdir(sourceDir))
    .filter((fileName) => /^\d+\.json$/.test(fileName))
    .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));

  let updatedFiles = 0;
  let updatedMatches = 0;

  for (const fileName of sourceFiles) {
    const sourcePath = path.join(sourceDir, fileName);
    const targetPath = path.join(targetDir, fileName);

    let targetText;
    try {
      targetText = await fs.readFile(targetPath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }

    const source = parseJson(await fs.readFile(sourcePath, "utf8"), sourcePath);
    const target = parseJson(targetText, targetPath);
    const sourceMatches = new Map(
      (source.matches || []).map((match) => [String(match.id), match]),
    );
    let fileChanged = false;

    for (const targetMatch of target.matches || []) {
      const sourceMatch = sourceMatches.get(String(targetMatch.id));
      if (!sourceMatch || !restoreMatch(sourceMatch, targetMatch)) continue;
      fileChanged = true;
      updatedMatches += 1;
    }

    if (!fileChanged) continue;
    await fs.writeFile(targetPath, `${JSON.stringify(target, null, 2)}\n`, "utf8");
    updatedFiles += 1;
    console.log(`Restored TSAPI enrichment in matchweek ${path.basename(fileName, ".json")}.`);
  }

  console.log(
    `Restored TSAPI enrichment for ${updatedMatches} matches across ${updatedFiles} matchweek files.`,
  );
}

await main();
