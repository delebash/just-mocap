// Face movements measured the same way on any set of face points, as ratios to the eye-corner distance so face size
// drops out: mouth opening, mouth width, each eye's opening, each brow's height, and each pupil's place in its eye.
// A layout names which point is which; "right" and "left" are the person's own.
import { correlation, mean, spread, subtract } from "./panoptic.js";

const distance = (a, b) => Math.hypot(...subtract(a, b));
const middle = (a, b) => a.map((v, k) => (v + b[k]) / 2);

// Pupil place in its eye: along the corner-to-corner line (0 = middle), and across it, both in eye widths.
function gaze(pupil, cornerA, cornerB) {
  const axis = subtract(cornerB, cornerA);
  const width = Math.hypot(...axis);
  const offset = subtract(pupil, middle(cornerA, cornerB));
  return [(offset[0] * axis[0] + offset[1] * axis[1]) / width / width, (offset[1] * axis[0] - offset[0] * axis[1]) / width / width];
}

// OpenPose's 70-point face: 36-41 is the person's right eye, 42-47 the left, 68 and 69 the pupils.
export const OPENPOSE = {
  corners: [36, 45],
  mouthInner: [62, 66],
  mouthCorners: [48, 54],
  rightEye: { outer: 36, inner: 39, lids: [[37, 41], [38, 40]], brow: 19, pupil: 68 },
  leftEye: { outer: 45, inner: 42, lids: [[43, 47], [44, 46]], brow: 24, pupil: 69 },
};

// MediaPipe's canonical face mesh: 33/133 and 263/362 eye corners, lids as in the eye-aspect-ratio literature, 13/14
// inner lips, 61/291 mouth corners, 105/334 mid-brows, irises 468 and 473.
export const MEDIAPIPE = {
  corners: [33, 263],
  mouthInner: [13, 14],
  mouthCorners: [61, 291],
  rightEye: { outer: 33, inner: 133, lids: [[160, 144], [158, 153]], brow: 105, pupil: 468 },
  leftEye: { outer: 263, inner: 362, lids: [[385, 380], [387, 373]], brow: 334, pupil: 473 },
};

// Every point index a layout uses, for building a correspondence to another point set.
export const layoutPoints = (layout) => [
  ...layout.corners,
  ...layout.mouthInner,
  ...layout.mouthCorners,
  ...["rightEye", "leftEye"].flatMap((side) => {
    const eye = layout[side];
    return [eye.outer, eye.inner, ...eye.lids.flat(), eye.brow];
  }),
];

// The same layout with every index passed through a map (e.g. MediaPipe index to mesh vertex). Pupils without a
// mapping are dropped, and gaze is then not measured.
export function mapLayout(layout, map) {
  const eye = (e) => ({ outer: map[e.outer], inner: map[e.inner], lids: e.lids.map((pair) => pair.map((i) => map[i])), brow: map[e.brow], pupil: map[e.pupil] });
  return {
    corners: layout.corners.map((i) => map[i]),
    mouthInner: layout.mouthInner.map((i) => map[i]),
    mouthCorners: layout.mouthCorners.map((i) => map[i]),
    rightEye: eye(layout.rightEye),
    leftEye: eye(layout.leftEye),
  };
}

// MediaPipe's iris points given to the nearer eye, since its own left/right order is not the person's.
export function mediapipeLayout(points) {
  const towardRight = distance(points[468], middle(points[33], points[133])) < distance(points[468], middle(points[263], points[362]));
  return {
    ...MEDIAPIPE,
    rightEye: { ...MEDIAPIPE.rightEye, pupil: towardRight ? 468 : 473 },
    leftEye: { ...MEDIAPIPE.leftEye, pupil: towardRight ? 473 : 468 },
  };
}

export function faceMeasures(p, layout) {
  const unit = distance(p[layout.corners[0]], p[layout.corners[1]]);
  const out = {
    mouthOpen: distance(p[layout.mouthInner[0]], p[layout.mouthInner[1]]) / unit,
    mouthWide: distance(p[layout.mouthCorners[0]], p[layout.mouthCorners[1]]) / unit,
  };
  for (const side of ["right", "left"]) {
    const eye = layout[`${side}Eye`];
    const width = distance(p[eye.outer], p[eye.inner]);
    out[`${side}EyeOpen`] = mean(eye.lids.map(([a, b]) => distance(p[a], p[b]))) / width;
    out[`${side}Brow`] = distance(p[eye.brow], middle(p[eye.outer], p[eye.inner])) / unit;
    if (eye.pupil !== undefined && p[eye.pupil]) {
      const [along, across] = gaze(p[eye.pupil], p[eye.outer], p[eye.inner]);
      out[`${side}GazeAlong`] = along;
      out[`${side}GazeAcross`] = across;
    }
  }
  return out;
}

// Each measured movement with the ARKit blendshapes that should follow it, own side first.
export const BLENDSHAPE_ROWS = [
  ["mouthOpen", ["jawOpen"]],
  ["mouthWide", ["mouthSmileLeft", "mouthSmileRight", "mouthStretchLeft", "mouthStretchRight"]],
  ["rightEyeOpen", ["eyeBlinkRight", "eyeBlinkLeft"]],
  ["leftEyeOpen", ["eyeBlinkLeft", "eyeBlinkRight"]],
  ["rightBrow", ["browOuterUpRight", "browOuterUpLeft"]],
  ["leftBrow", ["browOuterUpLeft", "browOuterUpRight"]],
  ["rightGazeAlong", ["eyeLookOutRight", "eyeLookOutLeft"]],
  ["leftGazeAlong", ["eyeLookOutLeft", "eyeLookOutRight"]],
  ["rightGazeAcross", ["eyeLookUpRight", "eyeLookUpLeft"]],
  ["leftGazeAcross", ["eyeLookUpLeft", "eyeLookUpRight"]],
];

// Prints, for each movement both sides measured: how much the real face moves (spread), how closely the method's
// points follow it (correlation), how much of it they show (spread ratio), and the matching ARKit blendshapes'
// correlation, own side first and the other side in brackets as a check. real and mine are per-frame measure objects
// (null where missing); shapeOf(name) gives a blendshape's per-frame values.
export function printFaceTable(real, mine, shapeOf) {
  const both = real.map((r, t) => Boolean(r && mine[t]));
  console.log("movement            real spread  points: follows  shown   ARKit blendshape: follows (other side)");
  for (const [key, shapes] of BLENDSHAPE_ROWS) {
    const truth = real.map((r, t) => (both[t] && r[key] !== undefined ? r[key] : null));
    if (truth.every((v) => v === null)) continue;
    const ours = mine.map((m, t) => (both[t] ? (m[key] ?? null) : null));
    const blend = shapes.map((name) => correlation(truth, shapeOf(name).map((s, t) => (both[t] ? s : null))));
    const text =
      key === "mouthWide"
        ? `smile ${blend[0].toFixed(2)}/${blend[1].toFixed(2)}, stretch ${blend[2].toFixed(2)}/${blend[3].toFixed(2)}`
        : `${shapes[0]} ${blend[0].toFixed(2)}${blend[1] === undefined ? "" : ` (${blend[1].toFixed(2)})`}`;
    console.log(`  ${key.padEnd(17)} ${spread(truth).toFixed(4).padStart(8)}   ${correlation(truth, ours).toFixed(2).padStart(15)}  ${((spread(ours) / spread(truth)) * 100).toFixed(0).padStart(4)}%   ${text}`);
  }
}
