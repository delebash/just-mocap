// Finds the best stretch of a CMU Panoptic sequence for a hand test: one person, both hands scored well, and the camera
// that sees them largest with both hands in frame. Run: node panoptic_pick.js <sequence folder> [seconds]
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [folder, secondsArg] = process.argv.slice(2);
const seconds = Number(secondsArg ?? 20);
const fps = 29.97;
const length = Math.round(seconds * fps);
const handDir = join(folder, "hdHand3d");
const files = readdirSync(handDir).filter((name) => name.endsWith(".json"));
const frameOf = (name) => Number(name.match(/hd(\d+)/)[1]);
const mean = (list) => list.reduce((s, v) => s + v, 0) / list.length;

// The files hold unquoted NaN in places, so they are cleaned before parsing.
const read = (name) => JSON.parse(readFileSync(join(handDir, name), "utf8").replace(/\bnan\b/gi, "null"));
const sample = read(files[Math.floor(files.length / 2)]);
console.log("keys", Object.keys(sample), "person keys", Object.keys(sample.people[0] ?? {}), "hand keys", Object.keys(sample.people[0]?.left_hand ?? sample.people[0]?.right_hand ?? {}));

const frames = new Map();
for (const name of files) {
  const data = read(name);
  const people = data.people ?? [];
  const row = { people: people.length, left: null, right: null };
  if (people.length === 1) {
    for (const side of ["left", "right"]) {
      const hand = people[0][`${side}_hand`];
      if (hand?.landmarks?.length === 63 && hand.landmarks.every((v) => v !== null)) {
        const points = Array.from({ length: 21 }, (_, i) => hand.landmarks.slice(i * 3, i * 3 + 3));
        row[side] = { points, score: mean(hand.averageScore ?? [0]) };
      }
    }
  }
  frames.set(frameOf(name), row);
}
const numbers = [...frames.keys()].sort((a, b) => a - b);
console.log(`frames ${numbers.length}, from ${numbers[0]} to ${numbers.at(-1)}`);

// Best window: most frames with both hands of good score.
let best = null;
for (let start = numbers[0]; start + length < numbers.at(-1); start += 15) {
  let count = 0;
  let score = 0;
  for (let t = start; t < start + length; t += 1) {
    const row = frames.get(t);
    if (row?.left && row?.right) {
      count += 1;
      score += row.left.score + row.right.score;
    }
  }
  const value = count + score / Math.max(count, 1) / 2;
  if (!best || value > best.value) best = { start, count, meanScore: score / Math.max(count, 1) / 2, value };
}
console.log("best window", best);

// A second window for fast hands: mostly complete, with the highest median wrist speed, away from the first window.
const speedAt = (t) => {
  const [a, b] = [frames.get(t), frames.get(t - 1)];
  if (!a?.left || !a?.right || !b?.left || !b?.right) return null;
  const move = (side) => Math.hypot(...a[side].points[0].map((v, i) => v - b[side].points[0][i]));
  return Math.max(move("left"), move("right"));
};
let fast = null;
for (let start = numbers[0] + 1; start + length < numbers.at(-1); start += 15) {
  if (Math.abs(start - best.start) < length) continue;
  const speeds = [];
  for (let t = start; t < start + length; t += 1) {
    const speed = speedAt(t);
    if (speed !== null) speeds.push(speed);
  }
  if (speeds.length < length * 0.9) continue;
  speeds.sort((a, b) => a - b);
  const median = speeds[Math.floor(speeds.length / 2)];
  if (!fast || median > fast.medianCmPerFrame) fast = { start, count: speeds.length, medianCmPerFrame: median };
}
console.log("fast window", fast);

// Which HD camera sees those hands largest, with the wrists inside the frame.
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
const rows = [];
for (const cam of calibration.cameras.filter((c) => c.type === "hd")) {
  let inside = 0;
  let total = 0;
  const spans = [];
  for (let t = best.start; t < best.start + length; t += 3) {
    const row = frames.get(t);
    if (!row?.left || !row?.right) continue;
    total += 1;
    let ok = true;
    for (const side of ["left", "right"]) {
      const pts = row[side].points.map((p) => project(cam, p));
      if (pts.some((p) => p.u < 0 || p.v < 0 || p.u >= 1920 || p.v >= 1080 || p.depth <= 0)) ok = false;
      let most = 0;
      for (const a of pts) for (const b of pts) most = Math.max(most, Math.hypot(a.u - b.u, a.v - b.v));
      spans.push(most);
    }
    if (ok) inside += 1;
  }
  spans.sort((a, b) => a - b);
  rows.push({ name: cam.name, insideShare: inside / Math.max(total, 1), span: spans[Math.floor(spans.length / 2)] });
}
rows.sort((a, b) => b.insideShare - a.insideShare || b.span - a.span);
console.log(rows.slice(0, 8).map((r) => `${r.name}: both hands inside ${(r.insideShare * 100).toFixed(0)}%, median hand span ${r.span?.toFixed(0)} px`).join("\n"));
writeFileSync(join(folder, "pick.json"), JSON.stringify({ ...best, fast, length, camera: rows[0].name, cameras: rows }, null, 1));
