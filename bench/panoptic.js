// Shared helpers for scoring against CMU Panoptic: camera projection with the sequence's own calibration, and the
// statistics every truth_*.js script reports.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const mean = (list) => list.reduce((s, v) => s + v, 0) / list.length;
export const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)] ?? NaN;
export const subtract = (a, b) => a.map((v, i) => v - b[i]);

// Projects a 3D point in Panoptic's world (cm) into an HD camera's image, with lens distortion. The camera is the
// CAMERA environment variable, else pick.json's; scale is the clip's size against 1080p.
export function cameraProjector(folder, scale) {
  const pick = JSON.parse(readFileSync(join(folder, "pick.json"), "utf8"));
  const calibration = JSON.parse(readFileSync(join(folder, "calibration.json"), "utf8"));
  const camera = calibration.cameras.find((c) => c.type === "hd" && c.name === (process.env.CAMERA ?? pick.camera));
  return (p) => {
    const c = camera.R.map((row, i) => row[0] * p[0] + row[1] * p[1] + row[2] * p[2] + camera.t[i][0]);
    const [x, y] = [c[0] / c[2], c[1] / c[2]];
    const r2 = x * x + y * y;
    const [k1, k2, p1, p2, k3] = camera.distCoef;
    const radial = 1 + k1 * r2 + k2 * r2 * r2 + k3 * r2 * r2 * r2;
    const [xd, yd] = [x * radial + 2 * p1 * x * y + p2 * (r2 + 2 * x * x), y * radial + p1 * (r2 + 2 * y * y) + 2 * p2 * x * y];
    return [(camera.K[0][0] * xd + camera.K[0][1] * yd + camera.K[0][2]) * scale, (camera.K[1][1] * yd + camera.K[1][2]) * scale];
  };
}

export function correlation(a, b) {
  const pairs = a.map((v, t) => [v, b[t]]).filter(([x, y]) => x !== null && x !== undefined && y !== null && y !== undefined);
  if (pairs.length < 10) return NaN;
  const [mx, my] = [0, 1].map((k) => mean(pairs.map((p) => p[k])));
  const cov = pairs.reduce((s, [x, y]) => s + (x - mx) * (y - my), 0);
  const [vx, vy] = [0, 1].map((k) => Math.sqrt(pairs.reduce((s, p) => s + (p[k] - [mx, my][k]) ** 2, 0)));
  return vx && vy ? cov / (vx * vy) : NaN;
}

export const spread = (list) => {
  const known = list.filter((v) => v !== null && v !== undefined);
  const m = mean(known);
  return Math.sqrt(mean(known.map((v) => (v - m) ** 2)));
};
