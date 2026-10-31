// Finds where the measured fingers move most in a Panoptic sequence, so a finger test has real articulation to follow.
// Run: node panoptic_fingers.js <sequence folder> [seconds]
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [folder, secondsArg] = process.argv.slice(2);
const length = Math.round(Number(secondsArg ?? 10) * 29.97);
const handDir = join(folder, "hdHand3d");
const subtract = (a, b) => a.map((v, i) => v - b[i]);
const bend = (a, b, c) => {
  const [u, v] = [subtract(b, a), subtract(c, b)];
  const lengths = Math.hypot(...u) * Math.hypot(...v);
  if (!lengths) return null;
  return (Math.acos(Math.min(1, Math.max(-1, u.reduce((s, x, i) => s + x * v[i], 0) / lengths))) * 180) / Math.PI;
};
const JOINTS = [5, 9, 13, 17].flatMap((f) => [[f, f + 1, f + 2], [f + 1, f + 2, f + 3]]);
const switched = new Set([...readFileSync(join(handDir, "lrSwitchedFrames.txt"), "utf8").matchAll(/Frame:\s*(\d+)/g)].map((m) => Number(m[1])));
const frames = new Map();
for (const name of readdirSync(handDir).filter((n) => n.endsWith(".json"))) {
  const t = Number(name.match(/hd(\d+)/)[1]);
  if (switched.has(t)) continue;
  const data = JSON.parse(readFileSync(join(handDir, name), "utf8").replace(/\bnan\b/gi, "null"));
  if (data.people?.length !== 1) continue;
  const row = {};
  for (const side of ["left", "right"]) {
    const hand = data.people[0][`${side}_hand`];
    if (hand?.landmarks?.length !== 63 || hand.landmarks.some((v) => v === null)) continue;
    const p = Array.from({ length: 21 }, (_, i) => hand.landmarks.slice(i * 3, i * 3 + 3));
    row[side] = { bends: JOINTS.map(([a, b, c]) => bend(p[a], p[b], p[c])), score: hand.averageScore.reduce((s, v) => s + v, 0) / hand.averageScore.length };
  }
  frames.set(t, row);
}
const numbers = [...frames.keys()].sort((a, b) => a - b);
const spread = (list) => {
  const mean = list.reduce((s, v) => s + v, 0) / list.length;
  return Math.sqrt(list.reduce((s, v) => s + (v - mean) ** 2, 0) / list.length);
};
const results = [];
for (let start = numbers[0]; start + length < numbers.at(-1); start += 30) {
  for (const side of ["left", "right"]) {
    const series = [];
    for (let t = start; t < start + length; t += 1) {
      const hand = frames.get(t)?.[side];
      if (hand) series.push(hand);
    }
    if (series.length < length * 0.9) continue;
    const perJoint = JOINTS.map((_, j) => spread(series.map((h) => h.bends[j])));
    const score = series.reduce((s, h) => s + h.score, 0) / series.length;
    results.push({ start, side, count: series.length, spread: perJoint.sort((a, b) => a - b)[4], score });
  }
}
results.sort((a, b) => b.spread - a.spread);
const chosen = [];
for (const r of results) {
  if (chosen.every((c) => Math.abs(c.start - r.start) >= length)) chosen.push(r);
  if (chosen.length === 6) break;
}
for (const r of chosen) console.log(`start ${r.start}  ${r.side}  frames ${r.count}  finger movement ${r.spread.toFixed(1)} deg  score ${r.score.toFixed(2)}`);
