import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(webDir, "src/pages/projects.tsx");
const source = fs.readFileSync(sourcePath, "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(`converted-signals: ${message}`);
}

const opportunitiesStart = source.indexOf("/* OPPORTUNITIES */");
const leadsStart = source.indexOf("/* LEADS */", opportunitiesStart);
assert(opportunitiesStart >= 0 && leadsStart > opportunitiesStart, "could not isolate the opportunities grid");
const opportunitiesGrid = source.slice(opportunitiesStart, leadsStart);

const predicateStart = source.indexOf("const isConvertedOpp");
const predicateEnd = source.indexOf("// Use the same forecast-window", predicateStart);
assert(predicateStart >= 0 && predicateEnd > predicateStart, "shared opportunity predicate is missing");
const predicate = source.slice(predicateStart, predicateEnd);
assert(predicate.includes("o.stage === CONVERTED_STAGE"), "shared predicate must retain the explicit converted stage");
assert(predicate.includes("projectsByTitle.get"), "shared predicate must use the title index");
assert(predicate.includes(".some(p => sameJobFields(o, p))"), "shared predicate must qualify title matches with sameJobFields");

assert(
  /\{isConvertedOpp\(o\) && <ConvertedTag \/>}/.test(opportunitiesGrid),
  "the Opps ID tag must call isConvertedOpp",
);
assert(
  /rowClassName=\{o => isConvertedOpp\(o\)/.test(opportunitiesGrid),
  "the Opps converted row tint must call isConvertedOpp",
);

const clickStart = opportunitiesGrid.indexOf("onRowClick={o => {");
const clickEnd = opportunitiesGrid.indexOf("onRowHover={o =>", clickStart);
assert(clickStart >= 0 && clickEnd > clickStart, "could not isolate the Opps row-click handler");
const clickPath = opportunitiesGrid.slice(clickStart, clickEnd);
assert(
  /if\s*\(isConvertedOpp\(o\)\)\s*\{/.test(clickPath),
  "the converted popup click path must call isConvertedOpp",
);
assert(
  !/o\.stage\s*===\s*CONVERTED_STAGE/.test(clickPath),
  "the converted popup click path must not use a bare stage-only check",
);

// Keep the important false-negative case explicit: a same-job project makes
// an otherwise open opportunity converted, while a conflicting job does not.
const fixtureSameJob = (a, b) =>
  ["client", "bu", "division"].every((field) => {
    const left = String(a[field] ?? "").trim().toLowerCase();
    const right = String(b[field] ?? "").trim().toLowerCase();
    return !left || !right || left === right;
  });
const fixtureProject = {
  name: "Same Job",
  client: "Acme",
  bu: "North",
  division: "Design",
};
const fixtureOpp = {
  name: " same job ",
  stage: "Proposal",
  client: "acme",
  bu: "north",
  division: "design",
};
const fixtureProjectsByTitle = new Map([["same job", [fixtureProject]]]);
const fixtureConverted = (opp) =>
  opp.stage === "Closed – Won" ||
  (fixtureProjectsByTitle.get(opp.name.trim().toLowerCase()) ?? [])
    .some((project) => fixtureSameJob(opp, project));
assert(
  fixtureOpp.stage !== "Closed – Won" && fixtureConverted(fixtureOpp),
  "same-title + sameJobFields fixture must be treated as converted without the won stage",
);

console.log("converted-signals: all assertions passed");