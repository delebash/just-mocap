// Whole-clip motion error with an upright line-up: GEM-X's up turned onto the measured up, then one turn about the vertical,
// one shift and one scale for the clip (the full similarity truth_body.js uses may also tilt the clip, which hides a drift).
// 12 joints as truth_body.js: shoulders, elbows, wrists, hips, knees, ankles, left then right.
// Run from bench/: node truth_upright.js <truth dir> <start> <gembody.json ...>
import { readFileSync } from "node:fs";
import { join } from "node:path";

const [dir, startArg, ...files] = process.argv.slice(2);
const start = Number(startArg);
const TRUTH_IDS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const truth = [];
for (let t = 0; t < 300; t += 1) {
  const data = JSON.parse(readFileSync(join(dir, "hdPose3d_stage1_coco19", `body3DScene_${String(start + t).padStart(8, "0")}.json`), "utf8"));
  truth[t] = data.bodies?.length === 1 ? TRUTH_IDS.map((k) => { const j = data.bodies[0].joints19; return [j[k * 4], -j[k * 4 + 1], j[k * 4 + 2]]; }) : null; // y up
}
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
for (const file of files) {
  const g = JSON.parse(readFileSync(file, "utf8")).global;
  const pairs = [];
  for (let t = 0; t < 300; t += 1) if (truth[t]) for (let k = 0; k < 12; k += 1) pairs.push([g[t][k], truth[t][k]]);
  // Mirror check: GEM-X is right-handed y up; Panoptic with y flipped is left-handed, so flip z too.
  const src = pairs.map(([p]) => p), dst = pairs.map(([, q]) => [q[0], q[1], -q[2]]);
  const cs = [0, 1, 2].map((i) => mean(src.map((p) => p[i]))), cd = [0, 1, 2].map((i) => mean(dst.map((p) => p[i])));
  // Best yaw (about y) and scale, in closed form on the horizontal plane; the vertical keeps its own scale with it.
  let sxx = 0, sxz = 0, norm = 0;
  for (let n = 0; n < src.length; n += 1) {
    const a = [src[n][0] - cs[0], src[n][2] - cs[2]], b = [dst[n][0] - cd[0], dst[n][2] - cd[2]];
    sxx += a[0] * b[0] + a[1] * b[1];
    sxz += a[0] * b[1] - a[1] * b[0];
  }
  const yaw = Math.atan2(sxz, sxx);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const turned = src.map((p) => [c * (p[0] - cs[0]) - s * (p[2] - cs[2]), p[1] - cs[1], s * (p[0] - cs[0]) + c * (p[2] - cs[2])]);
  let num = 0;
  for (let n = 0; n < src.length; n += 1) { num += turned[n][0] * (dst[n][0] - cd[0]) + turned[n][1] * (dst[n][1] - cd[1]) + turned[n][2] * (dst[n][2] - cd[2]); norm += turned[n][0] ** 2 + turned[n][1] ** 2 + turned[n][2] ** 2; }
  const scale = num / norm;
  const errors = turned.map((p, n) => Math.hypot(p[0] * scale + cd[0] - dst[n][0], p[1] * scale + cd[1] - dst[n][1], p[2] * scale + cd[2] - dst[n][2]));
  const vertical = turned.map((p, n) => Math.abs(p[1] * scale + cd[1] - dst[n][1]));
  console.log(`${file.split(/[\\/]/).pop().padEnd(36)} upright motion ${(mean(errors) * 10).toFixed(1)} mm, its vertical part ${(mean(vertical) * 10).toFixed(1)} mm (yaw ${(yaw * 180 / Math.PI).toFixed(1)} deg, scale ${scale.toFixed(3)})`);
}
