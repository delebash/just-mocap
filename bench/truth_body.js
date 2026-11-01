// Body accuracy against CMU Panoptic's measured joints: 12 limb joints, left then right, shoulder to ankle.
// pose: each frame aligned on its own, so it scores body shape only.
// motion: one alignment for the whole clip, so root path and drift count too.
// accel: error in joint acceleration against the truth, the standard smoothness-and-fidelity score.
// Run: node truth_body.js <sequence folder> <first hd frame> <frames> <raw.bvh> <smooth.bvh> [gem_body.json]
import { readFileSync } from "node:fs";
import { join } from "node:path";

const [folder, startArg, countArg, rawFile, smoothFile, gemFile] = process.argv.slice(2);
const [start, count] = [Number(startArg), Number(countArg)];
const mean = (list) => list.reduce((s, v) => s + v, 0) / list.length;
const subtract = (a, b) => a.map((v, i) => v - b[i]);

// Panoptic coco19: left shoulder, elbow, wrist, hip, knee, ankle, then right.
const TRUTH_IDS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const truth = [];
for (let t = 0; t < count; t += 1) {
  const name = `body3DScene_${String(start + t).padStart(8, "0")}.json`;
  const data = JSON.parse(readFileSync(join(folder, "hdPose3d_stage1_coco19", name), "utf8"));
  const body = data.bodies?.[0];
  truth[t] = data.bodies?.length === 1 ? TRUTH_IDS.map((j) => body.joints19.slice(j * 4, j * 4 + 3)) : null;
}

function fit(source, target) {
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
  for (let i = 0; i < 300; i += 1) {
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
  const rotate = (p) => R.map((row) => row[0] * p[0] + row[1] * p[1] + row[2] * p[2]);
  const rotated = a.map(rotate);
  const factor = rotated.reduce((s, p, n) => s + p[0] * b[n][0] + p[1] * b[n][1] + p[2] * b[n][2], 0) / rotated.reduce((s, p) => s + p[0] ** 2 + p[1] ** 2 + p[2] ** 2, 0);
  return (p) => rotate(subtract(p, cs)).map((v, k) => v * factor + ct[k]);
}

function score(name, frames) {
  const used = frames.map((f, t) => (f && truth[t] ? t : -1)).filter((t) => t >= 0);
  const pose = used.map((t) => {
    const apply = fit(frames[t], truth[t]);
    return mean(frames[t].map((p, j) => Math.hypot(...subtract(apply(p), truth[t][j]))));
  });
  const apply = fit(used.flatMap((t) => frames[t]), used.flatMap((t) => truth[t]));
  const aligned = frames.map((f) => f?.map(apply) ?? null);
  const motion = used.map((t) => mean(aligned[t].map((p, j) => Math.hypot(...subtract(p, truth[t][j])))));
  const accel = [];
  const shake = [];
  for (const t of used) {
    if (!aligned[t - 1] || !aligned[t - 2] || !truth[t - 1] || !truth[t - 2]) continue;
    for (let j = 0; j < 12; j += 1) {
      const a = [0, 1, 2].map((k) => aligned[t][j][k] - 2 * aligned[t - 1][j][k] + aligned[t - 2][j][k]);
      const b = [0, 1, 2].map((k) => truth[t][j][k] - 2 * truth[t - 1][j][k] + truth[t - 2][j][k]);
      accel.push(Math.hypot(...subtract(a, b)));
      shake.push(Math.hypot(...a));
    }
  }
  const hipPath = (list) => used.map((t) => [0, 1, 2].map((k) => (list[t][3][k] + list[t][9][k]) / 2));
  const [mine, real] = [hipPath(aligned), hipPath(truth)];
  const pathError = mean(mine.map((p, i) => Math.hypot(...subtract(p, real[i]))));
  const range = (list) => Math.max(...[0, 1, 2].map((k) => Math.max(...list.map((p) => p[k])) - Math.min(...list.map((p) => p[k]))));
  console.log(
    `  ${name.padEnd(22)} pose ${(mean(pose) * 10).toFixed(1).padStart(6)} mm  motion ${(mean(motion) * 10).toFixed(1).padStart(6)} mm  accel err ${(mean(accel) * 10).toFixed(2).padStart(6)}  shake ${(mean(shake) * 10).toFixed(2).padStart(6)}  hip path err ${(pathError * 10).toFixed(1).padStart(6)} mm  hip travel ${(range(mine) * 10).toFixed(0).padStart(5)} mm (real ${(range(real) * 10).toFixed(0)})`,
  );
}

function readBvh(path, swapLegs) {
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
  const id = (name) => joints.findIndex((j) => j.name === name);
  const size = (j) => 1 + joints[j].children.reduce((s, c) => s + size(c), 0);
  const biggest = (j) => joints[j].children.reduce((best, c) => (size(c) > size(best) ? c : best), joints[j].children[0]);
  const leg = (hip) => {
    const knee = biggest(hip);
    return [hip, knee, biggest(knee)];
  };
  const arm = (shoulder, wrist) => [shoulder, joints[wrist].parent, wrist];
  const [first, second] = swapLegs ? [id("joint_018"), id("joint_002")] : [id("joint_002"), id("joint_018")];
  const left = [...arm(id("joint_075"), id("joint_077")), ...leg(first)];
  const right = [...arm(id("joint_039"), id("joint_041")), ...leg(second)];
  const wanted = [...left, ...right];
  return frames.map((values) => {
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
    return wanted.map((j) => out[j]);
  });
}

console.log(`frames with one person measured: ${truth.filter(Boolean).length} of ${count}`);
score("SAM legs as listed", readBvh(rawFile, false));
score("SAM legs swapped", readBvh(rawFile, true));
const pick = process.env.SWAP_LEGS === "1";
score("SAM 3D Body raw", readBvh(rawFile, pick));
score("SAM 3D Body smoothed", readBvh(smoothFile, pick));
if (gemFile) {
  const gem = JSON.parse(readFileSync(gemFile, "utf8"));
  score("GEM-X world, contact IK", gem.global);
  if (gem.rawGlobal) score("GEM-X world, raw", gem.rawGlobal);
  score("GEM-X camera", gem.incam);
}
