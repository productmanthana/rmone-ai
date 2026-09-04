import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const SRC = "exports/RMOne_Phase2_Response";
const OUT = path.join(SRC, "cropped");
fs.mkdirSync(OUT, { recursive: true });

const files = [
  "P1_Operational_Command_Center.png",
  "P2_Decision_Support_Brief.png",
  "P3_Live_Pulse_Daily_Briefing.png",
  "P4_Visual_Forecasting.png",
  "P5_Role_COO.png",
  "P5_Role_CFO.png",
  "P5_Role_ResourceMgr.png",
  "P5_Role_ProjectMgr.png",
  "P5_Role_Executive.png",
];

// Source: 1920x1080. Mockup is 390x844 centered horizontally near top.
// Crop tight around the mockup with small margin.
const cropBox = { left: 760, top: 0, width: 400, height: 870 };

for (const f of files) {
  const out = path.join(OUT, f);
  await sharp(path.join(SRC, f))
    .extract(cropBox)
    .png({ quality: 95 })
    .toFile(out);
  const meta = await sharp(out).metadata();
  console.log(`${f} → ${meta.width}x${meta.height}`);
}
