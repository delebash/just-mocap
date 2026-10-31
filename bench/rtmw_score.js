// RTMW's hands scored like the others, but in 2D because it has no depth: inner finger bends, RMS second difference.
// MediaPipe's 2D row in audit_hands.js is the fair comparison. Run: node rtmw_score.js <rtmw.json>
import { readFileSync } from "node:fs";

const { frames } = JSON.parse(readFileSync(process.argv[2], "utf8"));
const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
const bend = (a, b, c) => {
  const [ux, uy, vx, vy] = [b[0] - a[0], b[1] - a[1], c[0] - b[0], c[1] - b[1]];
  const lengths = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  if (!lengths) return null;
  return (Math.acos(Math.min(1, Math.max(-1, (ux * vx + uy * vy) / lengths))) * 180) / Math.PI;
};
const fingers = [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [0, 9, 10, 11, 12], [0, 13, 14, 15, 16], [0, 17, 18, 19, 20]];
for (const [side, offset] of [["left", 91], ["right", 112]]) {
  const jitters = [];
  const spreads = [];
  for (const chain of fingers) {
    for (let i = 2; i + 1 < chain.length; i += 1) {
      const run = frames.map((f) => bend(f[offset + chain[i - 1]], f[offset + chain[i]], f[offset + chain[i + 1]]));
      let [sum, count] = [0, 0];
      for (let t = 2; t < run.length; t += 1) {
        if (run[t] === null || run[t - 1] === null || run[t - 2] === null) continue;
        sum += (run[t] - 2 * run[t - 1] + run[t - 2]) ** 2;
        count += 1;
      }
      jitters.push(Math.sqrt(sum / count));
      const known = run.filter((v) => v !== null);
      const mean = known.reduce((s, v) => s + v, 0) / known.length;
      spreads.push(Math.sqrt(known.reduce((s, v) => s + (v - mean) ** 2, 0) / known.length));
    }
  }
  console.log(`rtmw 2D ${side}: inner ${jitters.length} joints jitter ${median(jitters).toFixed(2)} spread ${median(spreads).toFixed(2)}`);
}
