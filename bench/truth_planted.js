// Planted-ankle bob and slide in GEM-X's own world, split by GEM-X's own contact: frames inside a measured stance where
// GEM-X calls that foot firmly planted (heel or toe above 0.8), and the rest of the measured stance.
// Run from bench/: node truth_planted.js <truth dir> <start> <contacts.json> <gembody.json ...>
import { readFileSync } from "node:fs";
import { join } from "node:path";
const [dir, startArg, contactFile, ...files] = process.argv.slice(2);
const start = Number(startArg);
const contacts = JSON.parse(readFileSync(contactFile, "utf8")); // per frame [leftFoot, leftToe, rightFoot, rightToe]
const ankles = [];
for (let t = 0; t < 300; t += 1) {
  const data = JSON.parse(readFileSync(join(dir, "hdPose3d_stage1_coco19", `body3DScene_${String(start + t).padStart(8, "0")}.json`), "utf8"));
  ankles[t] = data.bodies?.length === 1 ? [8, 14].map((k) => data.bodies[0].joints19.slice(k * 4, k * 4 + 3)) : null;
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
const stances = [];
for (const side of [0, 1]) {
  let run = [];
  for (let t = 0; t < 299; t += 1) {
    if (ankles[t] && ankles[t + 1] && dist(ankles[t][side], ankles[t + 1][side]) < 1) run.push(t);
    else { if (run.length >= 8) stances.push({ side, frames: run }); run = []; }
  }
  if (run.length >= 8) stances.push({ side, frames: run });
}
for (const file of files) {
  const g = JSON.parse(readFileSync(file, "utf8")).global;
  const parts = { firm: [], edge: [] };
  for (const { side, frames } of stances) {
    const firm = frames.filter((t) => Math.max(contacts[t][side * 2], contacts[t][side * 2 + 1]) > 0.8);
    const edge = frames.filter((t) => !firm.includes(t));
    for (const [key, list] of [["firm", firm], ["edge", edge]]) {
      if (list.length < 3) continue;
      const p = list.map((t) => g[t][side === 0 ? 5 : 11]);
      const cy = mean(p.map((q) => q[1]));
      parts[key].push(...p.map((q) => Math.abs(q[1] - cy)));
    }
  }
  console.log(`${file.split(/[\/]/).pop().padEnd(34)} bob where GEM-X is firm ${(mean(parts.firm) * 10).toFixed(2)} mm (${parts.firm.length} frames), at stance edges ${(mean(parts.edge) * 10).toFixed(2)} mm (${parts.edge.length} frames)`);
}
