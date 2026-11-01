// Prints a BVH rig's main chains with bone lengths, so unnamed joints can be matched to shoulders, knees and so on.
// Run: node bvh_tree.js <file.bvh>
import { readFileSync } from "node:fs";

const lines = readFileSync(process.argv[2], "utf8").split(/\r?\n/);
const joints = [];
const stack = [];
for (const raw of lines) {
  const line = raw.trim();
  if (line.startsWith("MOTION")) break;
  const parts = line.split(/\s+/);
  if (parts[0] === "ROOT" || parts[0] === "JOINT") {
    joints.push({ name: parts[1], parent: stack.at(-1) ?? -1, offset: [0, 0, 0], children: [] });
    if (stack.length) joints[stack.at(-1)].children.push(joints.length - 1);
    stack.push(joints.length - 1);
  } else if (parts[0] === "End") stack.push(-2);
  else if (parts[0] === "}") stack.pop();
  else if (parts[0] === "OFFSET" && stack.at(-1) >= 0) joints[stack.at(-1)].offset = parts.slice(1, 4).map(Number);
}
const size = (j) => 1 + joints[j].children.reduce((s, c) => s + size(c), 0);
const walk = (j, depth) => {
  const joint = joints[j];
  const length = Math.hypot(...joint.offset);
  if (size(j) >= 3 || depth < 2) {
    console.log(`${" ".repeat(depth)}${joint.name} len ${length.toFixed(1)} offset ${joint.offset.map((v) => v.toFixed(1)).join(",")} kids ${joint.children.length} size ${size(j)}`);
  }
  if (size(j) > 40 || depth < 2) joint.children.forEach((c) => walk(c, depth + 1));
  else if (size(j) > 3 && joint.children.length <= 3) joint.children.forEach((c) => size(c) >= 3 && walk(c, depth + 1));
};
walk(0, 0);
