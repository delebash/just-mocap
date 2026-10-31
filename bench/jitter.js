// Scores finger jitter the same way for a BVH and for MediaPipe world landmarks: each finger joint's bend angle over time,
// then the RMS second difference (degrees per frame squared) and the angle's spread, so a frozen hand can't look best.
// Run: node jitter.js bvh <file.bvh> | node jitter.js mp <file.json>
import { readFileSync } from "node:fs";

const [mode, file] = process.argv.slice(2);

function parseBvh(text) {
  const lines = text.split(/\r?\n/);
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
    } else if (parts[0] === "End") {
      stack.push(-2);
    } else if (parts[0] === "}") {
      stack.pop();
    } else if (parts[0] === "OFFSET" && stack.at(-1) >= 0) {
      joints[stack.at(-1)].offset = parts.slice(1, 4).map(Number);
    } else if (parts[0] === "CHANNELS" && stack.at(-1) >= 0) {
      joints[stack.at(-1)].channels = parts.slice(2);
    }
  }
  const count = Number(lines[index + 1].trim().split(/\s+/)[1]);
  const frames = [];
  for (let line = index + 3; line < index + 3 + count; line += 1) frames.push(lines[line].trim().split(/\s+/).map(Number));
  return { joints, frames };
}

const multiply = (a, b) => a.map((row) => [0, 1, 2].map((c) => row[0] * b[0][c] + row[1] * b[1][c] + row[2] * b[2][c]));
const apply = (m, v) => m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
function axis(letter, degrees) {
  const a = (degrees * Math.PI) / 180;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  if (letter === "X") return [[1, 0, 0], [0, c, -s], [0, s, c]];
  if (letter === "Y") return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
}

function forwardKinematics({ joints, frames }) {
  return frames.map((values) => {
    let cursor = 0;
    const world = [];
    const rotations = [];
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
        world[j] = position;
        rotations[j] = rotation;
      } else {
        const moved = apply(rotations[joint.parent], position);
        world[j] = moved.map((v, k) => v + world[joint.parent][k]);
        rotations[j] = multiply(rotations[joint.parent], rotation);
      }
    });
    return world;
  });
}

const subtract = (a, b) => a.map((v, i) => v - b[i]);
function bend(a, b, c) {
  const [u, v] = [subtract(b, a), subtract(c, b)];
  const dot = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const lengths = Math.hypot(...u) * Math.hypot(...v);
  if (!lengths) return null;
  return (Math.acos(Math.min(1, Math.max(-1, dot / lengths))) * 180) / Math.PI;
}

function score(series) {
  const secondDifferences = [];
  const spreads = [];
  for (const run of series) {
    const known = run.filter((v) => v !== null);
    if (known.length < 3) continue;
    const mean = known.reduce((s, v) => s + v, 0) / known.length;
    spreads.push(Math.sqrt(known.reduce((s, v) => s + (v - mean) ** 2, 0) / known.length));
    let sum = 0;
    let count = 0;
    for (let t = 2; t < run.length; t += 1) {
      if (run[t] === null || run[t - 1] === null || run[t - 2] === null) continue;
      sum += (run[t] - 2 * run[t - 1] + run[t - 2]) ** 2;
      count += 1;
    }
    if (count) secondDifferences.push(Math.sqrt(sum / count));
  }
  const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)] ?? NaN;
  return { joints: secondDifferences.length, jitter: median(secondDifferences), spread: median(spreads) };
}

function chainsFromWrist(joints, wrist) {
  const chains = [];
  const walk = (j, path) => {
    const next = [...path, j];
    if (!joints[j].children.length) {
      chains.push(next);
      return;
    }
    for (const child of joints[j].children) walk(child, next);
  };
  walk(wrist, []);
  return chains;
}

if (mode === "bvh") {
  const bvh = parseBvh(readFileSync(file, "utf8"));
  const world = forwardKinematics(bvh);
  const size = (j) => 1 + bvh.joints[j].children.reduce((s, c) => s + size(c), 0);
  const wrists = bvh.joints
    .map((joint, j) => ({ j, tips: chainsFromWrist(bvh.joints, j).length, size: size(j) }))
    .filter((row) => row.tips === 5 && row.size >= 15 && row.size <= 40)
    .filter((row, _, all) => !all.some((other) => other.j !== row.j && bvh.joints[row.j].parent === other.j));
  console.log(`bvh: ${bvh.joints.length} joints, ${bvh.frames.length} frames, wrists ${wrists.map((w) => bvh.joints[w.j].name)}`);
  for (const { j } of wrists) {
    const series = [];
    for (const chain of chainsFromWrist(bvh.joints, j)) {
      for (let i = 1; i + 1 < chain.length; i += 1) {
        series.push(world.map((frame) => bend(frame[chain[i - 1]], frame[chain[i]], frame[chain[i + 1]])));
      }
    }
    console.log(bvh.joints[j].name, JSON.stringify(score(series)));
  }
} else {
  const data = JSON.parse(readFileSync(file, "utf8"));
  const fingers = [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [0, 9, 10, 11, 12], [0, 13, 14, 15, 16], [0, 17, 18, 19, 20]];
  for (const side of ["Left", "Right"]) {
    const series = [];
    for (const finger of fingers) {
      for (let i = 1; i + 1 < finger.length; i += 1) {
        series.push(
          data.frames.map((hands) => {
            const hand = hands.find((h) => h.side === side);
            return hand ? bend(hand.world[finger[i - 1]], hand.world[finger[i]], hand.world[finger[i + 1]]) : null;
          }),
        );
      }
    }
    const found = data.frames.filter((hands) => hands.some((h) => h.side === side)).length;
    console.log(side, `found in ${found}/${data.frames.length}`, JSON.stringify(score(series)));
  }
}
