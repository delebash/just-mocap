// Fair finger score from saved results: the same physical hand, the same frames, the same coordinates.
// audit_hands.js and rtmw_score.js left three gaps, which this closes:
// 1. Its "MediaPipe 2D" dropped z from the world landmarks, while RTMW used image pixels. Here both use image pixels.
// 2. Its hand order differed by method. Here MediaPipe's tracks take their side from RTMW's left and right wrists.
// 3. Each method was scored on its own frames. Here a second difference counts only where every method has all three frames.
// Run: node matched_hands.js <mp.json> <raw.bvh> <smooth.bvh> <rtmw.json|-> <width> <height> [firstFrame lastFrame]
import { readFileSync } from "node:fs";

const [mpFile, rawFile, smoothFile, rtmwFile, widthArg, heightArg, firstArg, lastArg] = process.argv.slice(2);
const [width, height] = [Number(widthArg), Number(heightArg)];
const [first, last] = [Number(firstArg ?? 0), Number(lastArg ?? Infinity)];
const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)] ?? NaN;
const subtract = (a, b) => a.map((v, i) => v - b[i]);
function bend(a, b, c) {
  const [u, v] = [subtract(b, a), subtract(c, b)];
  const lengths = Math.hypot(...u) * Math.hypot(...v);
  if (!lengths) return null;
  const dot = u.reduce((s, x, i) => s + x * v[i], 0);
  return (Math.acos(Math.min(1, Math.max(-1, dot / lengths))) * 180) / Math.PI;
}

// Inner two bends of each finger, keypoint numbering shared by MediaPipe and RTMW's hand block.
const FINGERS = [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [0, 9, 10, 11, 12], [0, 13, 14, 15, 16], [0, 17, 18, 19, 20]];
const innerBends = (points) => FINGERS.flatMap((chain) => [2, 3].map((i) => bend(points[chain[i - 1]], points[chain[i]], points[chain[i + 1]])));

// --- BVH forward kinematics, the same as audit_hands.js.
function readBvh(path) {
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
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
  const series = {};
  for (const wrist of wrists) {
    const rows = chains(wrist).flatMap((chain) =>
      [chain.length - 3, chain.length - 2].map((i) => world.map((frame) => bend(frame[chain[i - 1]], frame[chain[i]], frame[chain[i + 1]]))),
    );
    // The rig's joints are unnamed. It faces +Z with Y up, so the character's left arm rests on +X.
    let restX = 0;
    for (let j = wrist; j >= 0; j = joints[j].parent) restX += joints[j].offset[0];
    series[restX > 0 ? "left" : "right"] = { name: joints[wrist].name, restX, rows };
  }
  return series;
}

// --- MediaPipe tracks by physical side.
const mp = JSON.parse(readFileSync(mpFile, "utf8")).frames;
const rtmw = rtmwFile === "-" ? null : JSON.parse(readFileSync(rtmwFile, "utf8")).frames;
const OFFSET = { left: 91, right: 112 };
const frameCount = mp.length;
const blank = () => Array.from({ length: frameCount }, () => null);
const track = { left: blank(), right: blank() };
let labelAgrees = 0;
let labelChecked = 0;
mp.forEach((hands, t) => {
  if (rtmw) {
    const wrists = Object.fromEntries(["left", "right"].map((side) => [side, rtmw[t][OFFSET[side]]]));
    const pairs = [];
    hands.forEach((hand, h) => {
      const at = [hand.screen[0][0] * width, hand.screen[0][1] * height];
      for (const side of ["left", "right"]) pairs.push({ h, side, distance: Math.hypot(at[0] - wrists[side][0], at[1] - wrists[side][1]) });
    });
    pairs.sort((a, b) => a.distance - b.distance);
    const [usedHand, usedSide] = [new Set(), new Set()];
    for (const { h, side } of pairs) {
      if (usedHand.has(h) || usedSide.has(side)) continue;
      usedHand.add(h);
      usedSide.add(side);
      track[side][t] = hands[h];
      labelChecked += 1;
      if (hands[h].side.toLowerCase() === side) labelAgrees += 1;
    }
  } else {
    // No RTMW run on this clip. On the others MediaPipe's label matched RTMW's side, so the label stands in.
    for (const hand of hands) track[hand.side.toLowerCase()][t] = hand;
  }
});
if (rtmw) console.log(`mediapipe label equals RTMW's side: ${labelAgrees} of ${labelChecked}`);

const raw = readBvh(rawFile);
const smooth = readBvh(smoothFile);
console.log(`bvh wrists: ${Object.entries(raw).map(([k, v]) => `${k}=${v.name} restX ${v.restX.toFixed(1)}`).join(", ")}; frames ${mp.length}`);

// Check the side mapping from the data: each SAM hand's bends should follow one MediaPipe hand far better than the other.
const correlation = (a, b) => {
  const pairs = a.map((v, t) => [v, b[t]]).filter(([x, y]) => x !== null && y !== null);
  if (pairs.length < 10) return NaN;
  const [mx, my] = [0, 1].map((k) => pairs.reduce((s, p) => s + p[k], 0) / pairs.length);
  const cov = pairs.reduce((s, [x, y]) => s + (x - mx) * (y - my), 0);
  const [vx, vy] = [0, 1].map((k) => Math.sqrt(pairs.reduce((s, p) => s + (p[k] - [mx, my][k]) ** 2, 0)));
  return vx && vy ? cov / (vx * vy) : NaN;
};
for (const samSide of ["left", "right"]) {
  const scores = ["left", "right"].map((mpSide) => {
    const values = raw[samSide].rows.map((run, b) => correlation(run, track[mpSide].map((hand) => (hand ? innerBends(hand.world)[b] : null))));
    return `${mpSide} ${median(values.filter((v) => !Number.isNaN(v))).toFixed(2)}`;
  });
  console.log(`SAM ${samSide} bends follow MediaPipe: ${scores.join(", ")}`);
}

for (const side of ["left", "right"]) {
  const pixel = (points) => points.map(([x, y]) => [x * width, y * height]);
  const methods = {
    "SAM raw 3D": raw[side].rows,
    "SAM smooth 3D": smooth[side].rows,
    "MP world 3D": Array.from({ length: 10 }, (_, b) => track[side].map((hand) => (hand ? innerBends(hand.world)[b] : null))),
    "MP image 2D": Array.from({ length: 10 }, (_, b) => track[side].map((hand) => (hand ? innerBends(pixel(hand.screen))[b] : null))),
  };
  if (rtmw) methods["RTMW image 2D"] = Array.from({ length: 10 }, (_, b) => rtmw.map((f) => innerBends(f.slice(OFFSET[side], OFFSET[side] + 21).map((p) => p.slice(0, 2)))[b]));

  // Frames where every method, MediaPipe included, has this frame and the two before it.
  const usable = [];
  for (let t = Math.max(first + 2, 2); t <= Math.min(last, frameCount - 1); t += 1) {
    if (track[side][t] && track[side][t - 1] && track[side][t - 2]) usable.push(t);
  }
  console.log(`${side}: MediaPipe found ${track[side].filter(Boolean).length} of ${frameCount} frames, ${usable.length} usable triples`);
  if (usable.length < 5) continue;
  for (const [name, rows] of Object.entries(methods)) {
    const jitters = [];
    const spreads = [];
    for (const run of rows) {
      let sum = 0;
      for (const t of usable) sum += (run[t] - 2 * run[t - 1] + run[t - 2]) ** 2;
      jitters.push(Math.sqrt(sum / usable.length));
      const values = usable.map((t) => run[t]);
      const mean = values.reduce((s, v) => s + v, 0) / values.length;
      spreads.push(Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length));
    }
    console.log(`  ${name.padEnd(14)} jitter ${median(jitters).toFixed(2).padStart(6)}  spread ${median(spreads).toFixed(2).padStart(6)}`);
  }
}
