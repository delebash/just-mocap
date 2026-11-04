// Hip height above its own floor over time, measured against GEM-X before and after the floor plant, each in its own
// world: no alignment. Floor = the median planted ankle height (truth: ankles still for 8+ frames; GEM-X: same frames).
// GEM-X is scaled by the leg-length ratio (hip to ankle, median over the clip) so a smaller GEM-X body doesn't read as low.
// Run from bench/: node truth_hip_height.js <truth dir> <start> <gembody before> <gembody after>
import { readFileSync } from "node:fs";
import { join } from "node:path";

const [dir, startArg, ...files] = process.argv.slice(2);
const start = Number(startArg);
const truth = [];
for (let t = 0; t < 300; t += 1) {
  const data = JSON.parse(readFileSync(join(dir, "hdPose3d_stage1_coco19", `body3DScene_${String(start + t).padStart(8, "0")}.json`), "utf8"));
  const j = data.bodies?.length === 1 ? data.bodies[0].joints19 : null;
  // coco19: hips 6 and 12, ankles 8 and 14; Panoptic's y points down, so height is -y.
  truth[t] = j ? { hip: -(j[6 * 4 + 1] + j[12 * 4 + 1]) / 2, ankles: [-j[8 * 4 + 1], -j[14 * 4 + 1]], hipPos: [6, 12].map((k) => j.slice(k * 4, k * 4 + 3)), anklePos: [8, 14].map((k) => j.slice(k * 4, k * 4 + 3)) } : null;
}
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
// Planted: an ankle that moves under 1 cm a frame for 8 frames in a row (as truth_body.js's stances).
const planted = [[], []];
for (const side of [0, 1]) {
  for (let t = 4; t < 296; t += 1) {
    if (!truth[t]) continue;
    let still = true;
    for (let k = t - 4; k < t + 4; k += 1) if (!truth[k] || !truth[k + 1] || dist(truth[k].anklePos[side], truth[k + 1].anklePos[side]) > 1) still = false;
    if (still) planted[side].push(t);
  }
}
const truthFloor = median([...planted[0].map((t) => truth[t].ankles[0]), ...planted[1].map((t) => truth[t].ankles[1])]);
const truthLeg = median(truth.filter(Boolean).flatMap((f) => [0, 1].map((s) => dist(f.hipPos[s], f.anklePos[s]))));
const truthHip = truth.map((f) => (f ? f.hip - truthFloor : null));
for (const file of files) {
  const g = JSON.parse(readFileSync(file, "utf8")).global; // 12 joints, cm, y up: Leg (hip) 3 and 9, Foot (ankle) 5 and 11
  const floor = median([...planted[0].map((t) => g[t][5][1]), ...planted[1].map((t) => g[t][11][1])]);
  const leg = median(g.flatMap((f) => [dist(f[3], f[5]), dist(f[9], f[11])]));
  const scale = truthLeg / leg;
  const hip = g.map((f) => (((f[3][1] + f[9][1]) / 2 - floor) * scale));
  const pairs = hip.map((h, t) => [h, truthHip[t]]).filter(([, r]) => r !== null);
  const diff = pairs.map(([h, r]) => h - r);
  const bias = mean(diff);
  const rms = Math.sqrt(mean(diff.map((d) => (d - bias) ** 2)));
  const ma = mean(pairs.map((p) => p[0])), mb = mean(pairs.map((p) => p[1]));
  const r = pairs.reduce((s, [a, b]) => s + (a - ma) * (b - mb), 0) / Math.sqrt(pairs.reduce((s, [a]) => s + (a - ma) ** 2, 0) * pairs.reduce((s, [, b]) => s + (b - mb) ** 2, 0));
  const first = mean(diff.slice(0, 30)), last = mean(diff.slice(-30));
  console.log(`${file.split(/[\\/]/).pop()}: hip height vs measured, after one height offset: rms ${rms.toFixed(1)} cm, follows ${r.toFixed(2)}, offset ${bias.toFixed(1)} cm, first second ${(first - bias).toFixed(1)}, last second ${(last - bias).toFixed(1)} cm (legs scaled x${scale.toFixed(3)})`);
}
console.log(`measured: hip height ${Math.min(...truthHip.filter((v) => v !== null)).toFixed(1)}-${Math.max(...truthHip.filter((v) => v !== null)).toFixed(1)} cm above its floor`);
