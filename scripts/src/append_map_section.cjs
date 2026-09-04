const fs = require("fs");
const JSZip = require("/home/runner/workspace/node_modules/.pnpm/jszip@3.10.1/node_modules/jszip");

(async () => {
  const docPath = "/home/runner/workspace/exports/RMOne_Service_Prime_Validation.docx";
  const buf = fs.readFileSync(docPath);
  const zip = await JSZip.loadAsync(buf);
  let docXml = await zip.file("word/document.xml").async("string");
  let relsXml = await zip.file("word/_rels/document.xml.rels").async("string");

  const img = fs.readFileSync("/home/runner/workspace/attached_assets/image_1776780110626.png");
  zip.file("word/media/pipeline_map_view.png", img);

  const newRel =
    '<Relationship Id="rId40" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/pipeline_map_view.png"/>';
  relsXml = relsXml.replace("</Relationships>", newRel + "</Relationships>");

  const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const h1 = (txt) => `<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:spacing w:before="240" w:after="120"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:cs="Calibri" w:eastAsia="Calibri" w:hAnsi="Calibri"/><w:b/><w:color w:val="1F4E79"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr><w:t xml:space="preserve">${escape(txt)}</w:t></w:r></w:p>`;
  const h2 = (txt) => `<w:p><w:pPr><w:pStyle w:val="Heading2"/><w:spacing w:before="180" w:after="80"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:cs="Calibri" w:eastAsia="Calibri" w:hAnsi="Calibri"/><w:b/><w:color w:val="2E75B6"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr><w:t xml:space="preserve">${escape(txt)}</w:t></w:r></w:p>`;
  const para = (txt) => `<w:p><w:pPr><w:spacing w:after="120"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:cs="Calibri" w:eastAsia="Calibri" w:hAnsi="Calibri"/><w:color w:val="222222"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:t xml:space="preserve">${escape(txt)}</w:t></w:r></w:p>`;
  const bullet = (txt) => `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:spacing w:after="80"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:cs="Calibri" w:eastAsia="Calibri" w:hAnsi="Calibri"/><w:color w:val="222222"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:t xml:space="preserve">${escape(txt)}</w:t></w:r></w:p>`;
  const imgPara = (rId, wpx, hpx, caption) => {
    const cx = Math.round(wpx * 9525);
    const cy = Math.round(hpx * 9525);
    const id = rId.replace("rId", "");
    return (
      `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="120" w:after="60"/></w:pPr><w:r><w:rPr><w:noProof/></w:rPr><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${id}" name="Picture ${id}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="Picture ${id}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>` +
      `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="200"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:cs="Calibri" w:eastAsia="Calibri" w:hAnsi="Calibri"/><w:i/><w:color w:val="595959"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr><w:t xml:space="preserve">${escape(caption)}</w:t></w:r></w:p>`
    );
  };

  const targetW = 320;
  const wpx = targetW;
  const hpx = Math.round(1280 * (targetW / 591));

  const sectionXml =
    h1("17. Pipeline Map View (Mobile)") +
    para("The Pipeline tab includes a map view, opened from the map icon in the top header next to the refresh button. It plots every record across PMM, OPM, LEM, and COM that has a usable location, clusters nearby pins, and ranks the cities by record count and combined value below the map.") +
    h2("17.1 Header Roll-up") +
    para("Above the map, three large counters summarise the entire pinned dataset:") +
    bullet("Cities — distinct cities resolved from the records (35 in the Liro_Poc tenant).") +
    bullet("Records — total geocoded records across all four modules (173 in Liro_Poc).") +
    bullet("Total Value — sum of contract / opportunity / lead value across those records ($4.5B in Liro_Poc).") +
    h2("17.2 Module Filter Chips") +
    para("Chips above the totals let the user narrow the map to a single module: All, PMM, OPM, LEM, or COM. The colour of each chip matches the corresponding pin colour on the map and the legend below it (green for Projects, orange for Opps, blue for Leads, purple for Companies).") +
    h2("17.3 Map and Clustering") +
    para("The map uses Apple Maps on iOS and Google Maps on Android. Pins for nearby records are merged into numbered cluster bubbles that expand as the user zooms in, so dense areas like the New York metro stay readable at country-level zoom.") +
    h2("17.4 Top Locations List") +
    para("Below the map, a ranked list shows the top cities by record count, with the dominant module noted next to each row (for example, San Francisco — 59 LEM, $1.2B). Tapping a row recentres the map on that city and filters the visible records to that location.") +
    h2("17.5 Current Data Coverage Note") +
    para("PMM and OPM rows in the Liro_Poc tenant do not currently carry City / State / geo coordinates that the map can resolve, so the pins shown today are sourced from LEM (leads) and COM (companies) only. The header rollup (35 cities / 173 records / $4.5B) reflects that subset. Once the PMM and OPM records have geographic fields populated upstream, the same map will pick them up automatically — no app change is required, the resolver already reads City / State / Address fields from every module.") +
    imgPara("rId40", wpx, hpx, "Figure 17-1 — Pipeline Map View: 35 cities and 173 geocoded records ($4.5B) with module filter chips, clustered pins, and the Top Locations list.");

  const marker = "<w:sectPr>";
  if (!docXml.includes(marker)) throw new Error("sectPr marker not found");
  docXml = docXml.replace(marker, sectionXml + marker);

  zip.file("word/document.xml", docXml);
  zip.file("word/_rels/document.xml.rels", relsXml);

  const out = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  fs.writeFileSync(docPath, out);
  console.log("Wrote", docPath, "size", out.length);
})();
