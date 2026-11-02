// Face accuracy against CMU Panoptic's measured face (70 points, OpenPose layout, pupils 68 and 69), with the truth
// projected into the camera and MediaPipe's image points measured the same way (face_measures.js).
// Note: 171204_pose1 has almost no face movement and no captured blinks, so it can't rank face methods; see the
// research file. Kept for sequences where faces do move.
// Run: node truth_face.js <sequence folder> <first hd frame> <frames> <scale> <mpface.json>
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { faceMeasures, mediapipeLayout, OPENPOSE, printFaceTable } from "./face_measures.js";
import { cameraProjector, mean } from "./panoptic.js";

const [folder, startArg, countArg, scaleArg, mpFile] = process.argv.slice(2);
const [start, count, scale] = [Number(startArg), Number(countArg), Number(scaleArg)];
const project = cameraProjector(folder, scale);

const truth = [];
let weak = 0;
for (let t = 0; t < count; t += 1) {
  try {
    const name = `faceRecon3D_hd${String(start + t).padStart(8, "0")}.json`;
    const data = JSON.parse(readFileSync(join(folder, "hdFace3d", name), "utf8"));
    const face = data.people?.length === 1 ? data.people[0].face70 : null;
    if (!face || mean(face.averageScore) < 0.5) {
      if (face) weak += 1;
      truth[t] = null;
      continue;
    }
    truth[t] = faceMeasures(Array.from({ length: 70 }, (_, i) => project(face.landmarks.slice(i * 3, i * 3 + 3))), OPENPOSE);
  } catch {
    truth[t] = null;
  }
}

const mp = JSON.parse(readFileSync(mpFile, "utf8")).frames.slice(0, count);
const found = mp.map((f) => {
  if (!f.points) return null;
  const p = f.points.map((q) => q.slice(0, 2));
  return faceMeasures(p, mediapipeLayout(p));
});
console.log(`frames with a measured face: ${truth.filter(Boolean).length} of ${count} (weak left out: ${weak}); MediaPipe found ${found.filter(Boolean).length}`);
printFaceTable(truth, found, (name) => mp.map((f) => f.shapes?.[name] ?? null));
