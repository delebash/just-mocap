// Finds where the measured person travels most in a Panoptic sequence, and how much each stretch has fast arms and legs.
// Run: node panoptic_walk.js <sequence folder> [seconds]
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [folder, secondsArg] = process.argv.slice(2);
const length = Math.round(Number(secondsArg ?? 10) * 29.97);
const dir = join(folder, "hdPose3d_stage1_coco19");
const frames = new Map();
for (const name of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
  const data = JSON.parse(readFileSync(join(dir, name), "utf8"));
  if (data.bodies?.length !== 1) continue;
  const joints = data.bodies[0].joints19;
  const at = (j) => joints.slice(j * 4, j * 4 + 3);
  frames.set(Number(name.match(/_(\d+)\.json/)[1]), { hip: at(2), lAnkle: at(8), rAnkle: at(14), lWrist: at(5), rWrist: at(11) });
}
const numbers = [...frames.keys()].sort((a, b) => a - b);
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
const rows = [];
for (let start = numbers[0]; start + length < numbers.at(-1); start += 30) {
  const list = [];
  for (let t = start; t < start + length; t += 1) if (frames.has(t)) list.push(frames.get(t));
  if (list.length < length * 0.95) continue;
  let path = 0;
  let ankle = 0;
  let wrist = 0;
  for (let i = 1; i < list.length; i += 1) {
    path += distance([list[i].hip[0], list[i].hip[2]], [list[i - 1].hip[0], list[i - 1].hip[2]]);
    ankle = Math.max(ankle, distance(list[i].lAnkle, list[i - 1].lAnkle), distance(list[i].rAnkle, list[i - 1].rAnkle));
    wrist = Math.max(wrist, distance(list[i].lWrist, list[i - 1].lWrist), distance(list[i].rWrist, list[i - 1].rWrist));
  }
  const [xs, zs] = [list.map((f) => f.hip[0]), list.map((f) => f.hip[2])];
  const span = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
  rows.push({ start, path, span, ankle, wrist });
}
rows.sort((a, b) => b.span - a.span);
const chosen = [];
// Speeds in cm per frame. Above about 8 m/s for an ankle or 12 m/s for a wrist is a tracking glitch, not a person.
for (const r of rows.filter((row) => row.ankle * 0.3 < 8 && row.wrist * 0.3 < 12)) {
  if (chosen.every((c) => Math.abs(c.start - r.start) >= length)) chosen.push(r);
  if (chosen.length === 6) break;
}
for (const r of chosen) console.log(`start ${r.start}  hip moves ${(r.span / 100).toFixed(2)} m, path ${(r.path / 100).toFixed(2)} m, fastest ankle ${(r.ankle * 0.3).toFixed(1)} m/s, fastest wrist ${(r.wrist * 0.3).toFixed(1)} m/s`);
