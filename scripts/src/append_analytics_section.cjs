const fs = require("fs");
const JSZip = require("/home/runner/workspace/node_modules/.pnpm/jszip@3.10.1/node_modules/jszip");

(async () => {
  const docPath = "/home/runner/workspace/exports/RMOne_Service_Prime_Validation.docx";
  const buf = fs.readFileSync(docPath);
  const zip = await JSZip.loadAsync(buf);
  let docXml = await zip.file("word/document.xml").async("string");
  let relsXml = await zip.file("word/_rels/document.xml.rels").async("string");

  const img1 = fs.readFileSync("/home/runner/workspace/attached_assets/image_1776780038552.png");
  const img2 = fs.readFileSync("/home/runner/workspace/attached_assets/image_1776780066101.png");

  zip.file("word/media/analytics_dashboard_full.png", img1);
  zip.file("word/media/analytics_dashboard_donut_tap.png", img2);

  const newRels =
    '<Relationship Id="rId38" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/analytics_dashboard_full.png"/>' +
    '<Relationship Id="rId39" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/analytics_dashboard_donut_tap.png"/>';
  relsXml = relsXml.replace("</Relationships>", newRels + "</Relationships>");

  const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const h1 = (txt) => `<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:spacing w:before="240" w:after="120"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:cs="Calibri" w:eastAsia="Calibri" w:hAnsi="Calibri"/><w:b/><w:color w:val="1F4E79"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr><w:t xml:space="preserve">${escape(txt)}</w:t></w:r></w:p>`;
  const h2 = (txt) => `<w:p><w:pPr><w:pStyle w:val="Heading2"/><w:spacing w:before="180" w:after="80"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:cs="Calibri" w:eastAsia="Calibri" w:hAnsi="Calibri"/><w:b/><w:color w:val="2E75B6"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr><w:t xml:space="preserve">${escape(txt)}</w:t></w:r></w:p>`;
  const para = (txt) => `<w:p><w:pPr><w:spacing w:after="120"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:cs="Calibri" w:eastAsia="Calibri" w:hAnsi="Calibri"/><w:color w:val="222222"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:t xml:space="preserve">${escape(txt)}</w:t></w:r></w:p>`;
  const bullet = (txt) => `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:spacing w:after="80"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:cs="Calibri" w:eastAsia="Calibri" w:hAnsi="Calibri"/><w:color w:val="222222"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:t xml:space="preserve">${escape(txt)}</w:t></w:r></w:p>`;

  const img = (rId, wpx, hpx, caption) => {
    const cx = Math.round(wpx * 9525);
    const cy = Math.round(hpx * 9525);
    const docPrId = rId.replace("rId", "");
    return (
      `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="120" w:after="60"/></w:pPr><w:r><w:rPr><w:noProof/></w:rPr><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${docPrId}" name="Picture ${docPrId}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${docPrId}" name="Picture ${docPrId}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>` +
      `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="200"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:cs="Calibri" w:eastAsia="Calibri" w:hAnsi="Calibri"/><w:i/><w:color w:val="595959"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr><w:t xml:space="preserve">${escape(caption)}</w:t></w:r></w:p>`
    );
  };

  const targetW = 320;
  const w1 = Math.round(356 * (targetW / 356));
  const h1px = Math.round(724 * (targetW / 356));
  const w2 = Math.round(345 * (targetW / 345));
  const h2px = Math.round(763 * (targetW / 345));

  const sectionXml =
    h1("16. Analytics Dashboard (Mobile)") +
    para("The Analytics Dashboard is a dedicated mobile screen accessed from the Home tab. It consolidates pipeline value, value distribution, opportunity status, client concentration, sector breakdown, geographic spread, and contract-type composition into a single scrollable view. All figures are computed live from the active Liro_Poc tenant and reconcile to the Pipeline tab counts shown above them.") +
    h2("16.1 Snapshot Cards (Open PMM, OPM Pipeline, LEM Leads)") +
    para("Three at-a-glance cards summarise the active book of work:") +
    bullet("Open PMM — total value of all open PMM projects (Closed flag = false). Currently $8M across 265 open projects.") +
    bullet("OPM Pipeline — combined value of active opportunities, excluding terminal statuses (Awarded, Won, Lost, Cancelled, Declined, Closed, Complete, Withdrawn, Dead, NoBid, Archive). Currently $70M across 7 opportunities.") +
    bullet("LEM Leads — open lead value and count using the same deny-list logic. Currently $71M across 35 leads.") +
    h2("16.2 Client Concentration (Donut Chart)") +
    para("Interactive donut chart showing the share of open PMM value by client. The legend lists the top eight clients with their percentage share. Tapping any slice highlights it and replaces the centre label with that client percentage and absolute open-value contribution, plus the project count. In the Liro_Poc tenant, NYC Department of Parks and Recreation leads at 31% ($2.5M / 27 projects), followed by NYC Housing Authority (24%), Con Edison (21%), and Town of Wayland (18%).") +
    h2("16.3 Value Distribution (PMM Bar Chart)") +
    para("Five-bucket histogram of all PMM rows by project value: <$1M, $1–5M, $5–15M, $15–50M, $50M+. Counts above each bar always sum to the total PMM count shown in the Pipeline tab header (267 in Liro_Poc), so the distribution and the list view never disagree. The dominant bucket in this tenant is <$1M (263 projects), reflecting the large number of small remediation and inspection jobs.") +
    h2("16.4 OPM Pipeline by Status") +
    para("A donut and horizontal-bar combination summarising opportunity stage distribution. The centre shows the active opportunity count (7 in Liro_Poc) and the bars show how many sit in each pipeline stage — currently 6 in Identify Opportunity and 1 in Assign.") +
    para("Below this section the dashboard continues with Top Cities, Sector Breakdown, Top Contract Types, and Top Project Request Types — all built from the same open-PMM dataset and adaptive to whichever fields the host tenant populates.") +
    img("rId38", w1, h1px, "Figure 16-1 — Analytics Dashboard scrolled view: snapshot cards, Client Concentration donut, Value Distribution histogram, and OPM Pipeline by Status.") +
    img("rId39", w2, h2px, "Figure 16-2 — Client Concentration donut with the largest slice (NYC Dept. of Parks and Recreation) tapped — centre label updates to show 31% / $2M / 27 projects, and the legend row is highlighted.");

  const marker = "<w:sectPr>";
  if (!docXml.includes(marker)) throw new Error("sectPr marker not found");
  docXml = docXml.replace(marker, sectionXml + marker);

  zip.file("word/document.xml", docXml);
  zip.file("word/_rels/document.xml.rels", relsXml);

  const out = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  fs.writeFileSync(docPath, out);
  console.log("Wrote", docPath, "size", out.length);
})();
