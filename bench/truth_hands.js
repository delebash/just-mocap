// Finger accuracy against measured hands from CMU Panoptic: the only score here that isn't steadiness.
// 3D: compares hand shape after rigid alignment (PA-MPJPE, mm), plus each finger joint's bend against the truth:
//     error, correlation, and how much of the real movement the method shows (spread ratio, so frozen fingers can't win).
// 2D: MediaPipe and RTMW image points against the truth projected into this camera, as PCK and pixels.
// Run: node truth_hands.js <sequence folder> <first hd frame> <frames> <scale> <raw.bvh> <smooth.bvh> <mp.json|-> <rtmw.json|->
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cameraProjector, correlation, mean, median, spread, subtract } from "./panoptic.js";

const [folder, startArg, countArg, scaleArg, rawFile, smoothFile, mpFile, rtmwFile] = process.argv.slice(2);
const [start, count, scale] = [Number(startArg), Number(countArg), Number(scaleArg)];

function bend(a, b, c) {
  const [u, v] = [subtract(b, a), subtract(c, b)];
  const lengths = Math.hypot(...u) * Math.hypot(...v);
  if (!lengths) return null;
  const dot = u.reduce((s, x, i) => s + x * v[i], 0);
  return (Math.acos(Math.min(1, Math.max(-1, dot / lengths))) * 180) / Math.PI;
}

// Inner bends per finger, in OpenPose hand order: thumb, index, middle, ring, pinky.
const FINGERS = [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [0, 9, 10, 11, 12], [0, 13, 14, 15, 16], [0, 17, 18, 19, 20]];
const NAMES = ["thumb", "index", "middle", "ring", "pinky"];
const BENDS = FINGERS.flatMap((chain, f) => [2, 3].map((i) => ({ finger: f, a: chain[i - 1], b: chain[i], c: chain[i + 1] })));
const bends = (points) => BENDS.map(({ a, b, c }) => bend(points[a], points[b], points[c]));

// --- Truth, in centimetres, and the frames marked as left-right switched.
const handDir = join(folder, "hdHand3d");
const switched = new Set(
  [...readFileSync(join(handDir, "lrSwitchedFrames.txt"), "utf8").matchAll(/Frame:\s*(\d+)/g)].map((m) => Number(m[1])),
);
const truthAt = (t) => {
  const name = `handRecon3D_hd${String(start + t).padStart(8, "0")}.json`;
  try {
    const data = JSON.parse(readFileSync(join(handDir, name), "utf8").replace(/\bnan\b/gi, "null"));
    return data.people?.length === 1 ? data.people[0] : null;
  } catch {
    return null;
  }
};
const truth = { left: [], right: [] };
for (let t = 0; t < count; t += 1) {
  const person = switched.has(start + t) ? null : truthAt(t);
  for (const side of ["left", "right"]) {
    const hand = person?.[`${side}_hand`];
    const good = hand?.landmarks?.length === 63 && hand.landmarks.every((v) => v !== null);
    truth[side][t] = good ? Array.from({ length: 21 }, (_, i) => hand.landmarks.slice(i * 3, i * 3 + 3)) : null;
  }
}

// --- Camera projection, with the sequence's own calibration.
const project = cameraProjector(folder, scale);

// --- Similarity alignment of 21 points, the standard PA step, by a Jacobi eigen solve of the 4x4 Horn matrix.
function procrustesError(source, target) {
  const centre = (pts) => [0, 1, 2].map((k) => mean(pts.map((p) => p[k])));
  const [cs, ct] = [centre(source), centre(target)];
  const [a, b] = [source.map((p) => subtract(p, cs)), target.map((p) => subtract(p, ct))];
  const S = [0, 1, 2].map((i) => [0, 1, 2].map((j) => a.reduce((s, p, n) => s + p[i] * b[n][j], 0)));
  const [xx, xy, xz, yx, yy, yz, zx, zy, zz] = S.flat();
  const N = [
    [xx + yy + zz, yz - zy, zx - xz, xy - yx],
    [yz - zy, xx - yy - zz, xy + yx, zx + xz],
    [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
    [xy - yx, zx + xz, yz + zy, -xx - yy + zz],
  ];
  let q = [1, 0, 0, 0];
  const shift = N.flat().reduce((s, v) => s + Math.abs(v), 0) + 1;
  for (let i = 0; i < 200; i += 1) {
    const next = N.map((row, r) => row.reduce((s, v, c) => s + v * q[c], 0) + shift * q[r]);
    const length = Math.hypot(...next);
    q = next.map((v) => v / length);
  }
  const [w, x, y, z] = q;
  const R = [
    [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
  ];
  const rotated = a.map((p) => R.map((row) => row[0] * p[0] + row[1] * p[1] + row[2] * p[2]));
  const top = rotated.reduce((s, p, n) => s + p[0] * b[n][0] + p[1] * b[n][1] + p[2] * b[n][2], 0);
  const bottom = rotated.reduce((s, p) => s + p[0] ** 2 + p[1] ** 2 + p[2] ** 2, 0);
  const factor = top / bottom;
  return mean(rotated.map((p, n) => Math.hypot(...p.map((v, k) => v * factor - b[n][k]))));
}


// --- SAM 3D Body: forward kinematics from BVH, chains ordered pinky to thumb, last four joints of each are the four points.
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
  const total = Number(lines[index + 1].trim().split(/\s+/)[1]);
  const frames = [];
  for (let l = index + 3; l < index + 3 + total; l += 1) frames.push(lines[l].trim().split(/\s+/).map(Number));
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
  const hands = {};
  for (const wrist of wrists) {
    const order = chains(wrist); // pinky, ring, middle, index, thumb
    const pointsOf = (frame) => {
      const finger = (chain) => chain.slice(-4).map((j) => frame[j]);
      return [frame[wrist], ...finger(order[4]), ...finger(order[3]), ...finger(order[2]), ...finger(order[1]), ...finger(order[0])];
    };
    hands[joints[wrist].name === "joint_077" ? "left" : "right"] = world.map(pointsOf);
  }
  return hands;
}

function score3D(name, tracks, side) {
  const errors = [];
  const rows = BENDS.map(() => ({ method: [], truth: [] }));
  for (let t = 0; t < count; t += 1) {
    const [p, q] = [tracks[t], truth[side][t]];
    if (!q) continue;
    if (!p) {
      rows.forEach((r) => r.method.push(null) && r.truth.push(null));
      continue;
    }
    errors.push(procrustesError(p, q) * 10);
    const [mb, tb] = [bends(p), bends(q)];
    rows.forEach((r, b) => {
      r.method.push(mb[b]);
      r.truth.push(tb[b]);
    });
  }
  if (errors.length < 20) return console.log(`  ${name.padEnd(16)} ${side}: too few frames (${errors.length})`);
  const offsetFree = (r) => {
    const pairs = r.method.map((v, i) => [v, r.truth[i]]).filter(([a, b]) => a !== null && b !== null);
    const shift = mean(pairs.map(([a, b]) => a - b));
    return Math.sqrt(mean(pairs.map(([a, b]) => (a - b - shift) ** 2)));
  };
  const rmse = rows.map(offsetFree);
  const corr = rows.map((r) => correlation(r.method, r.truth)).filter((v) => !Number.isNaN(v));
  const ratio = rows.map((r) => spread(r.method) / spread(r.truth));
  const perFinger = NAMES.map((n, f) => {
    const list = BENDS.map((b, i) => (b.finger === f ? corr[i] : null)).filter((v) => v !== null && v !== undefined);
    return `${n} ${mean(list).toFixed(2)}`;
  });
  const truthMoves = NAMES.map((n, f) => {
    const list = rows.filter((_, i) => BENDS[i].finger === f).map((r) => spread(r.truth));
    return `${n} ${mean(list).toFixed(1)}`;
  });
  console.log(
    `  ${name.padEnd(16)} ${side.padEnd(5)} frames ${String(errors.length).padStart(3)}  shape ${median(errors).toFixed(1).padStart(5)} mm  bend error ${median(rmse).toFixed(1).padStart(5)} deg  follows truth ${median(corr).toFixed(2).padStart(5)}  movement ${(median(ratio) * 100).toFixed(0).padStart(4)}%  truth moves deg [${truthMoves.join(", ")}]`,
  );
}

function score2D(name, tracks, side) {
  const [errors, hits01, hits02] = [[], [], []];
  for (let t = 0; t < count; t += 1) {
    const [p, q] = [tracks[t], truth[side][t]];
    if (!q) continue;
    const pts = q.map(project);
    let span = 0;
    for (const a of pts) for (const b of pts) span = Math.max(span, Math.hypot(a[0] - b[0], a[1] - b[1]));
    if (!p) {
      hits01.push(0);
      hits02.push(0);
      continue;
    }
    const distance = pts.map((g, i) => Math.hypot(p[i][0] - g[0], p[i][1] - g[1]));
    errors.push(median(distance));
    hits01.push(mean(distance.map((d) => (d < 0.1 * span ? 1 : 0))));
    hits02.push(mean(distance.map((d) => (d < 0.2 * span ? 1 : 0))));
  }
  console.log(`  ${name.padEnd(16)} ${side.padEnd(5)} found ${String(errors.length).padStart(3)} of ${hits01.length}  median ${median(errors).toFixed(1).padStart(5)} px  PCK@0.1 ${(mean(hits01) * 100).toFixed(0).padStart(3)}%  PCK@0.2 ${(mean(hits02) * 100).toFixed(0).padStart(3)}%`);
}

// --- Frame alignment check, so a one-frame offset can't pass as model error.
const mp = mpFile === "-" ? null : JSON.parse(readFileSync(mpFile, "utf8")).frames;
const [width, height] = [1920 * scale, 1080 * scale];
if (mp) {
  const rows = [];
  for (let offset = -3; offset <= 3; offset += 1) {
    const distances = [];
    for (let t = 5; t < Math.min(count, 200) - 5; t += 1) {
      const q = truth.right[t + offset];
      const hands = mp[t];
      if (!q || !hands?.length) continue;
      const g = project(q[0]);
      distances.push(Math.min(...hands.map((h) => Math.hypot(h.screen[0][0] * width - g[0], h.screen[0][1] * height - g[1]))));
    }
    rows.push(`${offset}: ${median(distances).toFixed(1)}`);
  }
  console.log(`wrist distance to truth by frame offset, px: ${rows.join("  ")}`);
}

const nearest = (hands, side, t) => {
  const q = truth[side][t];
  if (!q || !hands?.length) return null;
  const g = project(q[0]);
  const ranked = hands
    .map((h) => ({ h, d: Math.hypot(h.screen[0][0] * width - g[0], h.screen[0][1] * height - g[1]) }))
    .sort((a, b) => a.d - b.d);
  let span = 0;
  const pts = q.map(project);
  for (const a of pts) for (const b of pts) span = Math.max(span, Math.hypot(a[0] - b[0], a[1] - b[1]));
  return ranked[0].d < span ? ranked[0].h : null;
};

const raw = readBvh(rawFile);
const smooth = readBvh(smoothFile);
const rtmw = rtmwFile === "-" ? null : JSON.parse(readFileSync(rtmwFile, "utf8")).frames;
for (const side of ["left", "right"]) {
  console.log(side);
  score3D("SAM raw", raw[side], side);
  score3D("SAM smoothed", smooth[side], side);
  const other = side === "left" ? "right" : "left";
  score3D("SAM other side", raw[other], side);
  if (mp) {
    const found = Array.from({ length: count }, (_, t) => nearest(mp[t], side, t));
    score3D("MediaPipe 3D", found.map((h) => h?.world.map((p) => p.map((v) => v * 100)) ?? null), side);
    score2D("MediaPipe 2D", found.map((h) => h?.screen.map(([x, y]) => [x * width, y * height]) ?? null), side);
  }
  if (rtmw) {
    const offset = side === "left" ? 91 : 112;
    score2D("RTMW 2D", rtmw.slice(0, count).map((f) => f.slice(offset, offset + 21).map((p) => p.slice(0, 2))), side);
  }
  if (process.env.GEM_POINTS) {
    const gem = JSON.parse(readFileSync(process.env.GEM_POINTS, "utf8"));
    const wrong = side === "left" ? "right" : "left";
    score3D("GEM-X fingers", gem.gem[side], side);
    score3D("GEM-X other side", gem.gem[wrong], side);
    score2D("GEM-X 2D points", gem.gem2d[side], side);
    if (process.env.JOIN_POINTS) {
      const join = JSON.parse(readFileSync(process.env.JOIN_POINTS, "utf8"));
      score3D("SAM in SOMA", join.samSoma[side], side);
      score3D("GEM-X + SAM fingers", join.joined[side], side);
      score3D("joined other side", join.joined[wrong], side);
    }
    if (gem.ego[side].length) {
      score3D("EgoHand raw", gem.ego[side], side);
      score3D("EgoHand smoothed", gem.egoSmooth[side], side);
      score3D("EgoHand other", gem.ego[wrong], side);
      score2D("EgoHand 2D", gem.ego2d[side], side);
    }
  }
}
