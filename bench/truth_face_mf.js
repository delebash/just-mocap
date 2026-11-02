// Face accuracy against Meta's Multiface (CC BY-NC 4.0, used here to measure only): each frame's face mesh, tracked
// from about 40 cameras, is projected into one camera, and MediaPipe's points on that camera's image are measured the
// same way (face_measures.js). Multiface's mesh has no eyeballs, so gaze is not measured here.
// Each MediaPipe point is tied once to one mesh vertex: the nearest front-facing vertex, by vote over the neutral
// frames (eyes, brows, corners) and the mouth-open frames (lips, which touch when the mouth is closed).
// Run: node truth_face_mf.js <subject dir> <camera> <mp json pattern with {e}> <expression> [expression ...]
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { faceMeasures, layoutPoints, MEDIAPIPE, mapLayout, mediapipeLayout, printFaceTable } from "./face_measures.js";

const [subject, cameraName, mpPattern, ...expressions] = process.argv.slice(2);
const NEUTRAL = "E001_Neutral_Eyes_Open";
const MOUTH_OPEN = "E004_Relaxed_Mouth_Open";
const LIPS = new Set([13, 14, 61, 291]);

// --- Camera: Multiface's KRT, nine lines per camera (name, K, distortion, RT, blank).
const krt = readFileSync(join(subject, "KRT"), "utf8").split(/\r?\n/);
const at = krt.findIndex((line) => line.trim() === cameraName);
const rows = (from, n) => krt.slice(from, from + n).map((line) => line.trim().split(/\s+/).map(Number));
const [K, RT] = [rows(at + 1, 3), rows(at + 5, 3)];
const toCamera = (v) => RT.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2] + r[3]);
const project = (c) => [(K[0][0] * c[0] + K[0][1] * c[1]) / c[2] + K[0][2], (K[1][1] * c[1]) / c[2] + K[1][2]];

function meshFrames(expression) {
  const dir = join(subject, "tracked_mesh", expression);
  return readdirSync(dir)
    .filter((n) => n.endsWith(".bin"))
    .sort()
    .map((n) => {
      // .bin vertices are head-local; the frame's _transform.txt (3x4) takes them to the rig's world, as the .obj has them.
      const buffer = readFileSync(join(dir, n));
      const values = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
      const T = readFileSync(join(dir, n.replace(".bin", "_transform.txt")), "utf8").trim().split(/\r?\n/).map((line) => line.trim().split(/\s+/).map(Number));
      const world = (v) => T.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2] + r[3]);
      const camera = Array.from({ length: values.length / 3 }, (_, i) => toCamera(world([values[i * 3], values[i * 3 + 1], values[i * 3 + 2]])));
      return { frame: n.replace(".bin", ""), camera, image: camera.map(project) };
    });
}

function mediapipeFrames(expression) {
  const data = JSON.parse(readFileSync(mpPattern.replace("{e}", expression), "utf8"));
  return new Map(data.frames.map((f) => [f.name.replace(".png", ""), f]));
}

// --- Tie each MediaPipe point to one vertex.
function vote(expression, indices) {
  const meshes = meshFrames(expression);
  const mp = mediapipeFrames(expression);
  const votes = new Map(indices.map((i) => [i, new Map()]));
  for (const mesh of meshes) {
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
const wanted = [...new Set(layoutPoints(MEDIAPIPE))];
const map = { ...vote(NEUTRAL, wanted.filter((i) => !LIPS.has(i))), ...vote(MOUTH_OPEN, wanted.filter((i) => LIPS.has(i))) };
const missing = wanted.filter((i) => map[i] === undefined);
if (missing.length) throw new Error(`no vertex found for MediaPipe points ${missing.join(", ")}`);
const truthLayout = mapLayout(MEDIAPIPE, map);
console.log(`camera ${cameraName}; MediaPipe point to mesh vertex: ${wanted.map((i) => `${i}>${map[i]}`).join(" ")}`);

// --- Score every expression together, since each holds one movement from neutral and back.
const real = [];
const mine = [];
const shapes = [];
for (const expression of expressions) {
  const mp = mediapipeFrames(expression);
  let found = 0;
  const meshes = meshFrames(expression);
  for (const mesh of meshes) {
    const face = mp.get(mesh.frame);
    real.push(faceMeasures(mesh.image, truthLayout));
    if (face?.points) {
      found += 1;
      mine.push(faceMeasures(face.points, mediapipeLayout(face.points)));
      shapes.push(face.shapes);
    } else {
      mine.push(null);
      shapes.push(null);
    }
  }
  console.log(`  ${expression}: ${meshes.length} frames, MediaPipe found ${found}`);
}
printFaceTable(real, mine, (name) => shapes.map((s) => s?.[name] ?? null));
