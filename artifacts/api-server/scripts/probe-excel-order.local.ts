// Local probe — hammers previewExcel/parseExcel on SheetJS-built workbooks
// (worksheets precede xl/workbook.xml in the archive) to verify the
// entry-order fallback: every attempt must succeed AND keep real tab names.
import { readFileSync, existsSync } from "fs";
import { parseExcel, previewExcel } from "../src/lib/excel.js";

const files = [
  "/tmp/edge-seed.xlsx",
  "/tmp/edge-cases.xlsx",
  "test-files/RM-ONE-Edge-Case-Test-Alston.xlsx",
];

for (const f of files) {
  if (!existsSync(f)) throw new Error(`missing probe file: ${f}`);
  const buf = readFileSync(f);
  let names0 = "";
  for (let i = 0; i < 8; i++) {
    const p = await previewExcel(buf);
    const s = await parseExcel(buf);
    const names = p.map(x => x.sheetName).join("|");
    if (i === 0) {
      names0 = names;
      console.log(`${f} sheets: ${names} parseRows=${s.map(x => x.rows.length).join(",")}`);
    }
    if (names !== names0) throw new Error(`NAMES DRIFTED on attempt ${i}: ${names} vs ${names0}`);
    if (p.length !== s.length) throw new Error(`preview/parse sheet-count mismatch: ${p.length} vs ${s.length}`);
    if (p.some(x => /^Sheet\d+$/.test(x.sheetName))) throw new Error(`FALLBACK NAME LEAKED: ${names}`);
  }
}
console.log("PROBE OK — 8x preview+parse per file, all succeeded, names stable");
