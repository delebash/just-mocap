// Audit of the finger jitter score. Checks three things that could bias it:
// 1. Which bends each side contributes, so a rigid joint can't lower the median.
// 2. Whether MediaPipe's Left/Right labels swap: hands are tracked by nearest wrist instead of by label.
// 3. How much of MediaPipe's jitter is its depth, by scoring with x and y only.
// Run: node audit_hands.js <mp.json> <file.bvh> <video width> <video height>
import { readFileSync } from "node:fs";

const [mpFile, bvhFile, width, height] = process.argv.slice(2);
const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)] ?? NaN;
const subtract = (a, b) => a.map((v, i) => v - b[i]);
function bend(a, b, c) {
  const [u, v] = [subtract(b, a), subtract(c, b)];
  const lengths = Math.hypot(...u) * Math.hypot(...v);
  if (!lengths) return null;
  const dot = u.reduce((s, x, i) => s + x * v[i], 0);
  return (Math.acos(Math.min(1, Math.max(-1, dot / lengths))) * 180) / Math.PI;
}
function jitter(run) {
  let [sum, count] = [0, 0];
  for (let t = 2; t < run.length; t += 1) {
    if (run[t] === null || run[t - 1] === null || run[t - 2] === null) continue;
    sum += (run[t] - 2 * run[t - 1] + run[t - 2]) ** 2;
    count += 1;
  }
  return count ? Math.sqrt(sum / count) : null;
}
function spread(run) {
  const known = run.filter((v) => v !== null);
  if (known.length < 3) return null;
  const mean = known.reduce((s, v) => s + v, 0) / known.length;
  return Math.sqrt(known.reduce((s, v) => s + (v - mean) ** 2, 0) / known.length);
}

// --- MediaPipe: follow each physical hand by nearest wrist position, not by its label.
const data = JSON.parse(readFileSync(mpFile, "utf8"));
const tracks = [[], []];
const last = [null, null];
let swaps = 0;
const previousLabel = [null, null];
data.frames.forEach((hands, t) => {
  const taken = new Set();
  [0, 1].forEach((slot) => (tracks[slot][t] = null));
  for (const hand of hands) {
    const wrist = hand.screen[0];
    const distance = [0, 1].map((slot) => (last[slot] && !taken.has(slot) ? Math.hypot(wrist[0] - last[slot][0], wrist[1] - last[slot][1]) : Infinity));
    let slot = distance[0] <= distance[1] ? 0 : 1;
    if (distance[slot] === Infinity) slot = taken.has(0) ? 1 : last[0] === null ? 0 : 1;
    taken.add(slot);
    tracks[slot][t] = hand;
    last[slot] = wrist;
    if (previousLabel[slot] && previousLabel[slot] !== hand.side) swaps += 1;
    previousLabel[slot] = hand.side;
  }
});
console.log(`mediapipe: label changes on a tracked hand: ${swaps}`);

const span = [];
for (const hands of data.frames) {
  for (const hand of hands) {
    const points = hand.screen.map(([x, y]) => [x * width, y * height]);
    let most = 0;
    for (const a of points) for (const b of points) most = Math.max(most, Math.hypot(a[0] - b[0], a[1] - b[1]));
    span.push(most);
  }
}
console.log(`mediapipe: hand span in pixels, median ${median(span).toFixed(0)}, min ${Math.min(...span).toFixed(0)}, max ${Math.max(...span).toFixed(0)}`);

const fingers = { thumb: [0, 1, 2, 3, 4], index: [0, 5, 6, 7, 8], middle: [0, 9, 10, 11, 12], ring: [0, 13, 14, 15, 16], little: [0, 17, 18, 19, 20] };
const pick = (hand, i, flat) => (flat ? hand.world[i].slice(0, 2) : hand.world[i]);
for (const flat of [false, true]) {
  [0, 1].forEach((slot) => {
    const rows = [];
    for (const [name, chain] of Object.entries(fingers)) {
      for (let i = 1; i + 1 < chain.length; i += 1) {
        const run = tracks[slot].map((hand) => (hand ? bend(pick(hand, chain[i - 1], flat), pick(hand, chain[i], flat), pick(hand, chain[i + 1], flat)) : null));
        rows.push({ name: `${name}${i}`, inner: i >= 2, jitter: jitter(run), spread: spread(run) });
      }
    }
    const used = rows.filter((r) => r.jitter !== null);
    if (!used.length) return;
    const inner = used.filter((r) => r.inner);
    console.log(`mediapipe ${flat ? "2D" : "3D"} hand ${slot}: all ${used.length} joints jitter ${median(used.map((r) => r.jitter)).toFixed(2)}; inner ${inner.length} joints jitter ${median(inner.map((r) => r.jitter)).toFixed(2)} spread ${median(inner.map((r) => r.spread)).toFixed(2)}`);
  });
}

// --- SAM 3D Body: print the real hand tree so the joints can be matched.
if (bvhFile && bvhFile !== "-") {
  const lines = readFileSync(bvhFile, "utf8").split(/\r?\n/);
  const joints = [];
  const stack = [];
  let index = 0;
  for (; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line.startsWith("MOTION")) break;
    const parts = line.split(/\s+/);
    if (parts[0] === "ROOT" || parts[0] === "JOINT") {
      joints.push({ name: parts[1], parent: stack.at(-1) ?? -1, offset: [0, 0, 0], channels: [], children: [] });
      if (stack.length) joints[stack.at(-1)].children.push(joints.length - 1);
      stack.push(joints.length - 1);
    } else if (parts[0] === "End") stack.push(-2);
    else if (parts[0] === "}") stack.pop();
    else if (parts[0] === "OFFSET" && stack.at(-1) >= 0) joints[stack.at(-1)].offset = parts.slice(1, 4).map(Number);
    else if (parts[0] === "CHANNELS" && stack.at(-1) >= 0) joints[stack.at(-1)].channels = parts.slice(2);
  }
  const count = Number(lines[index + 1].trim().split(/\s+/)[1]);
  const frames = [];
  for (let l = index + 3; l < index + 3 + count; l += 1) frames.push(lines[l].trim().split(/\s+/).map(Number));
  const multiply = (a, b) => a.map((row) => [0, 1, 2].map((c) => row[0] * b[0][c] + row[1] * b[1][c] + row[2] * b[2][c]));
  const apply = (m, v) => m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
  const axis = (letter, degrees) => {
    const a = (degrees * Math.PI) / 180;
    const [c, s] = [Math.cos(a), Math.sin(a)];
    if (letter === "X") return [[1, 0, 0], [0, c, -s], [0, s, c]];
    if (letter === "Y") return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
    return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
  };
  const world = frames.map((values) => {
    let cursor = 0;
    const out = [];
    const rots = [];
    joints.forEach((joint, j) => {
      let position = [...joint.offset];
      let rotation = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
      for (const channel of joint.channels) {
        const value = values[cursor];
        cursor += 1;
        if (channel.endsWith("position")) position["XYZ".indexOf(channel[0])] = value;
        else rotation = multiply(rotation, axis(channel[0], value));
      }
      if (joint.parent < 0) {
        out[j] = position;
        rots[j] = rotation;
      } else {
        const moved = apply(rots[joint.parent], position);
        out[j] = moved.map((v, k) => v + out[joint.parent][k]);
        rots[j] = multiply(rots[joint.parent], rotation);
      }
    });
    return out;
  });
  const chains = (j, path = []) => {
    const next = [...path, j];
    return joints[j].children.length ? joints[j].children.flatMap((c) => chains(c, next)) : [next];
  };
  const size = (j) => 1 + joints[j].children.reduce((s, c) => s + size(c), 0);
  const wrists = joints
    .map((_, j) => j)
    .filter((j) => chains(j).length === 5 && size(j) >= 15 && size(j) <= 40)
    .filter((j, _, all) => !all.includes(joints[j].parent));
  for (const wrist of wrists) {
    console.log(`bvh wrist ${joints[wrist].name}: finger chains, bone cm:`);
    const inner = [];
    for (const chain of chains(wrist)) {
      const parts = [];
      chain.forEach((j, i) => {
        if (i === 0) return;
        const length = Math.hypot(...joints[j].offset);
        if (i + 1 < chain.length) {
          const run = world.map((frame) => bend(frame[chain[i - 1]], frame[chain[i]], frame[chain[i + 1]]));
          parts.push(`${length.toFixed(1)}[j${(jitter(run) ?? 0).toFixed(2)} s${(spread(run) ?? 0).toFixed(1)}]`);
          if (i >= chain.length - 3) inner.push({ jitter: jitter(run), spread: spread(run) });
        } else parts.push(length.toFixed(1));
      });
      console.log(`  ${joints[chain[1]].name}: ${parts.join(" ")}`);
    }
    console.log(`  inner ${inner.length} joints: jitter ${median(inner.map((r) => r.jitter)).toFixed(2)} spread ${median(inner.map((r) => r.spread)).toFixed(2)}`);
  }
}
