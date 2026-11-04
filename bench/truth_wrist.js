// Hand orientation against CMU Panoptic's measured hands, taken relative to the forearm so the body's alignment drops out.
// Forearm frame: elbow to wrist, and the plane of shoulder, elbow and wrist. Hand frame: wrist to middle knuckle, and the
// plane of the index and pinky knuckles. Error: the angle between the method's hand-in-forearm rotation and the truth's.
// Also split into the hand's pointing direction and its roll about it. Frames with an elbow straighter than 155° are
// skipped, because the arm plane is undefined there. Points only, so any method with hand and arm points can be scored.
// Run: node truth_wrist.js <sequence folder> <first hd frame> <frames> <sam raw.bvh> [join.json gem_body.json]
import { readFileSync } from "node:fs";
import { join } from "node:path";

const [folder, startArg, countArg, samFile, joinFile, bodyFile] = process.argv.slice(2);
const [start, count] = [Number(startArg), Number(countArg)];
const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => a.map((v) => v / Math.hypot(...a));
const degrees = (c) => (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
const median = (list) => {
  const s = [...list].sort((a, b) => a - b);
  return s.length ? (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2 : NaN;
};

// A frame from two points along its first axis and a third point fixing its plane, as three column vectors.
function frameOf(origin, along, inPlane) {
  const x = unit(sub(along, origin));
  const z = unit(cross(x, sub(inPlane, origin)));
  return [x, cross(z, x), z];
}
// The hand's rotation in the forearm's frame: F^T H, as rows.
const relative = (F, H) => F.map((f) => H.map((h) => dot(f, h)));
function compare(a, b) {
  const trace = [0, 1, 2].reduce((s, i) => s + dot([a[0][i], a[1][i], a[2][i]], [b[0][i], b[1][i], b[2][i]]), 0);
  const column = (m, i) => [m[0][i], m[1][i], m[2][i]];
  return { total: degrees((trace - 1) / 2), direction: degrees(dot(column(a, 0), column(b, 0))), roll: degrees(dot(column(a, 2), column(b, 2))) };
}
// Arm is [shoulder, elbow, wrist]; hand is 21 points in OpenPose order (0 wrist, 5 index, 9 middle, 17 pinky knuckles).
function wristRotation(arm, hand) {
  if (!arm || !hand || arm.some((p) => !p) || [0, 5, 9, 17].some((i) => !hand[i])) return null;
  const [shoulder, elbow, wrist] = arm;
  if (degrees(dot(unit(sub(shoulder, elbow)), unit(sub(wrist, elbow)))) > 155) return null;
  const forearm = frameOf(elbow, wrist, shoulder);
  // Hand: pointing from the wrist to the middle knuckle, palm normal from that and the pinky-to-index line.
  const x = unit(sub(hand[9], hand[0]));
  const z = unit(cross(x, sub(hand[5], hand[17])));
  return relative(forearm, [x, cross(z, x), z]);
}

// --- Truth: hands (hdHand3d) and arms (coco19: left shoulder 3, elbow 4, wrist 5; right 9, 10, 11), centimetres.
const handDir = join(folder, "hdHand3d");
const switched = new Set([...readFileSync(join(handDir, "lrSwitchedFrames.txt"), "utf8").matchAll(/Frame:\s*(\d+)/g)].map((m) => Number(m[1])));
const ARM_IDS = { left: [3, 4, 5], right: [9, 10, 11] };
const truth = { left: [], right: [] };
for (let t = 0; t < count; t += 1) {
  let person = null;
  try {
    const data = JSON.parse(readFileSync(join(handDir, `handRecon3D_hd${String(start + t).padStart(8, "0")}.json`), "utf8").replace(/\bnan\b/gi, "null"));
    person = !switched.has(start + t) && data.people?.length === 1 ? data.people[0] : null;
  } catch {}
  const body = JSON.parse(readFileSync(join(folder, "hdPose3d_stage1_coco19", `body3DScene_${String(start + t).padStart(8, "0")}.json`), "utf8"));
  const joints = body.bodies?.length === 1 ? body.bodies[0].joints19 : null;
  for (const side of ["left", "right"]) {
    const landmarks = person?.[`${side}_hand`]?.landmarks;
    const hand = landmarks?.length === 63 && landmarks.every((v) => v !== null) ? Array.from({ length: 21 }, (_, i) => landmarks.slice(i * 3, i * 3 + 3)) : null;
    const arm = joints ? ARM_IDS[side].map((j) => joints.slice(j * 4, j * 4 + 3)) : null;
    truth[side][t] = wristRotation(arm, hand);
  }
}

// --- SAM 3D Body: forward kinematics from its BVH; arm is shoulder joint_075/039, the wrist's parent, the wrist.
function readSam(path) {
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  const joints = [];
  const stack = [];
  let index = 0;
  for (; index < lines.length; index += 1) {
    const parts = lines[index].trim().split(/\s+/);
    if (parts[0] === "MOTION") break;
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
  const multiply = (a, b) => a.map((row) => [0, 1, 2].map((c) => row[0] * b[0][c] + row[1] * b[1][c] + row[2] * b[2][c]));
  const apply = (m, v) => m.map((row) => dot(row, v));
  const axis = (letter, value) => {
    const [c, s] = [Math.cos((value * Math.PI) / 180), Math.sin((value * Math.PI) / 180)];
    if (letter === "X") return [[1, 0, 0], [0, c, -s], [0, s, c]];
    if (letter === "Y") return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
    return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
  };
  const id = (name) => joints.findIndex((j) => j.name === name);
  const chains = (j, path = []) => (joints[j].children.length ? joints[j].children.flatMap((c) => chains(c, [...path, j])) : [[...path, j]]);
  const out = { left: [], right: [] };
  for (let l = index + 3; l < index + 3 + total; l += 1) {
    const values = lines[l].trim().split(/\s+/).map(Number);
    let cursor = 0;
    const pos = [];
    const rot = [];
    joints.forEach((joint, j) => {
      const position = [...joint.offset];
      let rotation = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
      for (const channel of joint.channels) {
        const value = values[cursor++];
        if (channel.endsWith("position")) position["XYZ".indexOf(channel[0])] = value;
        else rotation = multiply(rotation, axis(channel[0], value));
      }
      pos[j] = joint.parent < 0 ? position : apply(rot[joint.parent], position).map((v, k) => v + pos[joint.parent][k]);
      rot[j] = joint.parent < 0 ? rotation : multiply(rot[joint.parent], rotation);
    });
    for (const [side, shoulderName, wristName] of [["left", "joint_075", "joint_077"], ["right", "joint_039", "joint_041"]]) {
      const wrist = id(wristName);
      const order = chains(wrist).map((c) => c.slice(c.indexOf(wrist) + 1)); // pinky, ring, middle, index, thumb
      const knuckle = (chain) => pos[chain.at(-4)];
      const hand = Array(21).fill(null);
      [hand[0], hand[5], hand[9], hand[17]] = [pos[wrist], knuckle(order[3]), knuckle(order[2]), knuckle(order[0])];
      out[side].push(wristRotation([pos[id(shoulderName)], pos[joints[wrist].parent], pos[wrist]], hand));
    }
  }
  return out;
}

function score(name, tracks, side) {
  const errors = [];
  let used = 0;
  for (let t = 0; t < count; t += 1) {
    if (!truth[side][t] || !tracks[t]) continue;
    errors.push(compare(tracks[t], truth[side][t]));
    used += 1;
  }
  const m = (key) => median(errors.map((e) => e[key])).toFixed(1).padStart(5);
  console.log(`  ${name.padEnd(26)} ${side.padEnd(5)} frames ${String(used).padStart(3)}  wrist error ${m("total")} deg  (pointing ${m("direction")}, roll ${m("roll")})`);
}

const sam = readSam(samFile);
let joined = null;
if (joinFile) {
  const points = JSON.parse(readFileSync(joinFile, "utf8")).joinedWorld;
  const body = JSON.parse(readFileSync(bodyFile, "utf8")).global; // 12 joints: left Arm, ForeArm, Hand, Leg, Shin, Foot, then right
  const gap = [];
  joined = { left: [], right: [] };
  for (const [side, base] of [["left", 0], ["right", 6]]) {
    for (let t = 0; t < count; t += 1) {
      const hand = points[side][t];
      const arm = body[t] && [body[t][base], body[t][base + 1], body[t][base + 2]];
      if (hand && arm) gap.push(Math.hypot(...sub(hand[0], arm[2])));
      joined[side][t] = hand ? wristRotation(arm, hand) : null;
    }
  }
  console.log(`joined hand wrist to body wrist, median ${median(gap).toFixed(2)} cm (0 means the two files share a frame)`);
}
for (const side of ["left", "right"]) {
  const wrong = side === "left" ? "right" : "left";
  console.log(side);
  score("SAM 3D Body alone", sam[side], side);
  score("SAM 3D Body, other hand", sam[wrong], side);
  if (joined) score("GEM-X wrist + SAM fingers", joined[side], side);
}
