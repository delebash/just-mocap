// Brow measures against Multiface, for the brows decision: our brow-to-eye-centre ratio, MeFaMo's landmark distances
// (github.com/JimWest/MeFaMo, blendshape_config.py: brow 27/257 to the mean of 53,52,65 / 283,282,295; inner brow 9 to
// nose 6), and MediaPipe's own brow blendshapes, each against the real mesh's brow movement. Distances are 2D, over the
// eye-corner distance: Multiface's camera 400048 faces the person, standing in for MeFaMo's pose-normalised geometry.
// Mesh reading and the point-to-vertex vote are copied from bench/truth_face_mf.js.
// Run from bench/: node brows_mf.js <subject dir> <camera> <mp json pattern with {e} and {s}> <size> <expression ...>
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { faceMeasures, layoutPoints, MEDIAPIPE, mapLayout, mediapipeLayout } from "./face_measures.js";

const [subject, cameraName, pattern, size, ...expressions] = process.argv.slice(2);
const NEUTRAL = "E001_Neutral_Eyes_Open";
const MOUTH_OPEN = "E004_Relaxed_Mouth_Open";
const LIPS = new Set([13, 14, 61, 291]);
const MEFAMO = { right: [27, [53, 52, 65]], left: [257, [283, 282, 295]], inner: [9, 6] };
const INNER = { right: 107, left: 336 };

const krt = readFileSync(join(subject, "KRT"), "utf8").split(/\r?\n/);
const at = krt.findIndex((line) => line.trim() === cameraName);
const rows = (from, n) => krt.slice(from, from + n).map((line) => line.trim().split(/\s+/).map(Number));
const [K, RT] = [rows(at + 1, 3), rows(at + 5, 3)];
const toCamera = (v) => RT.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2] + r[3]);
const project = (c) => [(K[0][0] * c[0] + K[0][1] * c[1]) / c[2] + K[0][2], (K[1][1] * c[1]) / c[2] + K[1][2]];
function meshFrames(expression) {
  const dir = join(subject, "tracked_mesh", expression);
  return readdirSync(dir).filter((n) => n.endsWith(".bin")).sort().map((n) => {
    const buffer = readFileSync(join(dir, n));
    const values = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
    const T = readFileSync(join(dir, n.replace(".bin", "_transform.txt")), "utf8").trim().split(/\r?\n/).map((line) => line.trim().split(/\s+/).map(Number));
    const world = (v) => T.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2] + r[3]);
    const camera = Array.from({ length: values.length / 3 }, (_, i) => toCamera(world([values[i * 3], values[i * 3 + 1], values[i * 3 + 2]])));
    return { frame: n.replace(".bin", ""), camera, image: camera.map(project) };
  });
}
const mpFrames = (expression, s) => new Map(JSON.parse(readFileSync(pattern.replace("{e}", expression).replace("{s}", s), "utf8")).frames.map((f) => [f.name.replace(".png", ""), f]));
function vote(expression, indices) {
  const mp = mpFrames(expression, "1");
  const votes = new Map(indices.map((i) => [i, new Map()]));
  for (const mesh of meshFrames(expression)) {
    const face = mp.get(mesh.frame);
    if (!face?.points) continue;
    for (const i of indices) {
      const target = face.points[i];
      const near = mesh.image.map((p, v) => [Math.hypot(p[0] - target[0], p[1] - target[1]), v]).filter(([d]) => d < 25);
      if (!near.length) continue;
      const front = Math.min(...near.map(([, v]) => mesh.camera[v][2]));
      const [, best] = near.filter(([, v]) => mesh.camera[v][2] < front + 12).sort((a, b) => a[0] - b[0])[0];
      votes.get(i).set(best, (votes.get(i).get(best) ?? 0) + 1);
    }
  }
  return Object.fromEntries([...votes].map(([i, counts]) => [i, [...counts].sort((a, b) => b[1] - a[1])[0]?.[0]]));
}
const extra = [27, 53, 52, 65, 257, 283, 282, 295, 9, 6, 107, 336];
const wanted = [...new Set([...layoutPoints(MEDIAPIPE), ...extra])];
const map = { ...vote(NEUTRAL, wanted.filter((i) => !LIPS.has(i))), ...vote(MOUTH_OPEN, wanted.filter((i) => LIPS.has(i))) };
const truthLayout = mapLayout(MEDIAPIPE, map);

const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const avg = (ps) => [ps.reduce((s, p) => s + p[0], 0) / ps.length, ps.reduce((s, p) => s + p[1], 0) / ps.length];
function measures(p, index, layout) {
  const unit = d(p[index(MEDIAPIPE.corners[0])], p[index(MEDIAPIPE.corners[1])]);
  const base = faceMeasures(p, layout);
  const out = { ourRight: base.rightBrow, ourLeft: base.leftBrow, eyeRight: base.rightEyeOpen, eyeLeft: base.leftEyeOpen };
  for (const side of ["right", "left"]) {
    const [top, lower] = MEFAMO[side];
    out[`mefamo${side === "right" ? "Right" : "Left"}`] = d(p[index(top)], avg(lower.map((i) => p[index(i)]))) / unit;
    const eye = MEDIAPIPE[`${side}Eye`];
    out[`inner${side === "right" ? "Right" : "Left"}`] = d(p[index(INNER[side])], avg([p[index(eye.outer)], p[index(eye.inner)]])) / unit;
  }
  out.mefamoInner = d(p[index(MEFAMO.inner[0])], p[index(MEFAMO.inner[1])]) / unit;
  return out;
}
const real = [], mine = [], shapes = [], restFrames = [];
for (const expression of expressions) {
  const mp = mpFrames(expression, size);
  for (const mesh of meshFrames(expression)) {
    const face = mp.get(mesh.frame);
    if (!face?.points) continue;
    real.push(measures(mesh.image, (i) => map[i], truthLayout));
    mine.push(measures(face.points, (i) => i, mediapipeLayout(face.points)));
    shapes.push(face.shapes);
    restFrames.push(expression === NEUTRAL);
  }
}
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const corr = (a, b) => {
  const ma = a.reduce((s, v) => s + v, 0) / a.length, mb = b.reduce((s, v) => s + v, 0) / b.length;
  let n = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i += 1) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return n / Math.sqrt(da * db);
};
const col = (list, key) => list.map((m) => m[key]);
const shape = (name) => shapes.map((s) => s?.[name] ?? 0);
console.log(`size ${size}, ${real.length} frames`);
for (const [side, Side] of [["right", "Right"], ["left", "Left"]]) {
  const truth = col(real, `our${Side}`);
  const innerTruth = col(real, `inner${Side}`);
  console.log(`  ${side} brow height: our points ${corr(truth, col(mine, `our${Side}`)).toFixed(2)}, MeFaMo distance ${corr(truth, col(mine, `mefamo${Side}`)).toFixed(2)} (its own truth ${corr(col(real, `mefamo${Side}`), col(mine, `mefamo${Side}`)).toFixed(2)}), browOuterUp${Side} ${corr(truth, shape(`browOuterUp${Side}`)).toFixed(2)}, browDown${Side} ${corr(truth, shape(`browDown${Side}`)).toFixed(2)}`);
  console.log(`  ${side} inner brow height: our inner points ${corr(innerTruth, col(mine, `inner${Side}`)).toFixed(2)}, MeFaMo inner ${corr(innerTruth, col(mine, "mefamoInner")).toFixed(2)}, browInnerUp ${corr(innerTruth, shape("browInnerUp")).toFixed(2)}`);
  // One-sided, as ARKit defines the keys: browOuterUp is zero at rest and for lowered brows, browDown zero at rest and for
  // raised ones. So an Up key is scored against how far the real brow rises above its rest height (its median over the
  // neutral sequence), a Down key against how far it drops below.
  const rest = median(truth.filter((_, t) => restFrames[t]));
  const above = truth.map((h) => Math.max(0, h - rest));
  const below = truth.map((h) => Math.max(0, rest - h));
  const oneSided = (prefix) => `up ${corr(above, shape(`${prefix}browOuterUp${Side}`)).toFixed(2)}, down ${corr(below, shape(`${prefix}browDown${Side}`)).toFixed(2)}`;
  console.log(`  ${side} one-sided: MediaPipe's keys ${oneSided("")}; our points ${corr(above, col(mine, `our${Side}`)).toFixed(2)} up, ${corr(below, col(mine, `our${Side}`).map((v) => -v)).toFixed(2)} down${shapes.some((s) => s && s[`ours_browOuterUp${Side}`] !== undefined) ? `; new keys ${oneSided("ours_")}` : ""}`);
  // face_brows.py's keys, when the run carries them (tmp/brows_multiface.py writes them as ours_ and ours2d_ shapes).
  if (shapes.some((s) => s && s[`ours_browOuterUp${Side}`] !== undefined)) {
    const keys = (prefix) => `browOuterUp ${corr(truth, shape(`${prefix}browOuterUp${Side}`)).toFixed(2)}, browDown ${corr(truth, shape(`${prefix}browDown${Side}`)).toFixed(2)}, browInnerUp ${corr(innerTruth, shape(`${prefix}browInnerUp`)).toFixed(2)}`;
    console.log(`  ${side} new keys, head turn undone: ${keys("ours_")}; in 2D: ${keys("ours2d_")}; MediaPipe's: ${keys("")}`);
  }
}
for (const Side of ["Right", "Left"]) {
  const lid = col(real, `eye${Side}`);
  console.log(`  lid leak, ${Side.toLowerCase()}: real eye opening against our brow points ${corr(lid, col(mine, `our${Side}`)).toFixed(2)}, MeFaMo distance ${corr(lid, col(mine, `mefamo${Side}`)).toFixed(2)}, real brow ${corr(lid, col(real, `our${Side}`)).toFixed(2)}`);
}
