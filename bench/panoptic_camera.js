// For a Panoptic window, lists the HD cameras that keep both hands in frame, largest hands first.
// Run: node panoptic_camera.js <sequence folder> <first hd frame> <frames>
import { readFileSync } from "node:fs";
import { join } from "node:path";

const [folder, startArg, countArg] = process.argv.slice(2);
const [start, count] = [Number(startArg), Number(countArg)];
const calibration = JSON.parse(readFileSync(join(folder, "calibration.json"), "utf8"));
const project = (cam, p) => {
  const c = cam.R.map((row, i) => row[0] * p[0] + row[1] * p[1] + row[2] * p[2] + cam.t[i][0]);
  const [x, y] = [c[0] / c[2], c[1] / c[2]];
  const r2 = x * x + y * y;
  const [k1, k2, p1, p2, k3] = cam.distCoef;
  const radial = 1 + k1 * r2 + k2 * r2 * r2 + k3 * r2 * r2 * r2;
  const [xd, yd] = [x * radial + 2 * p1 * x * y + p2 * (r2 + 2 * x * x), y * radial + p1 * (r2 + 2 * y * y) + 2 * p2 * x * y];
  return { u: cam.K[0][0] * xd + cam.K[0][1] * yd + cam.K[0][2], v: cam.K[1][1] * yd + cam.K[1][2], depth: c[2] };
};
const frames = [];
for (let t = 0; t < count; t += 10) {
  const name = `handRecon3D_hd${String(start + t).padStart(8, "0")}.json`;
  const data = JSON.parse(readFileSync(join(folder, "hdHand3d", name), "utf8").replace(/\bnan\b/gi, "null"));
  const person = data.people?.[0];
  const hands = ["left", "right"]
    .map((side) => person?.[`${side}_hand`]?.landmarks)
    .filter((l) => l?.length === 63 && l.every((v) => v !== null))
    .map((l) => Array.from({ length: 21 }, (_, i) => l.slice(i * 3, i * 3 + 3)));
  frames.push(hands);
}
const rows = calibration.cameras
  .filter((c) => c.type === "hd")
  .map((cam) => {
    let inside = 0;
    let total = 0;
    const spans = [];
    for (const hands of frames) {
      for (const hand of hands) {
        total += 1;
        const pts = hand.map((p) => project(cam, p));
        if (pts.every((p) => p.u >= 0 && p.v >= 0 && p.u < 1920 && p.v < 1080 && p.depth > 0)) inside += 1;
        let most = 0;
        for (const a of pts) for (const b of pts) most = Math.max(most, Math.hypot(a.u - b.u, a.v - b.v));
        spans.push(most);
      }
    }
    spans.sort((a, b) => a - b);
    return { name: cam.name, inside: inside / Math.max(total, 1), span: spans[Math.floor(spans.length / 2)] };
  })
  .sort((a, b) => b.inside - a.inside || b.span - a.span);
console.log(rows.slice(0, 4).map((r) => `${r.name}: inside ${(r.inside * 100).toFixed(0)}%, hand ${r.span.toFixed(0)} px`).join("  |  "));
