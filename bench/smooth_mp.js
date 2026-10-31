// The same smoothing for MediaPipe, so the comparison is fair: a Gaussian on each landmark over a 7-frame window, gaps left
// as gaps, then the same score. A second pass adds a causal One Euro filter, the kind a live app would use.
// Run: node smooth_mp.js <in.json> <out-gauss.json> <out-euro.json>
import { readFileSync, writeFileSync } from "node:fs";

const [input, gaussOut, euroOut] = process.argv.slice(2);
const data = JSON.parse(readFileSync(input, "utf8"));

const weights = [-3, -2, -1, 0, 1, 2, 3].map((d) => Math.exp(-(d * d) / (2 * 1.5 * 1.5)));

function gauss(frames, side) {
  return frames.map((hands, t) => {
    const hand = hands.find((h) => h.side === side);
    if (!hand) return null;
    return hand.world.map((point, p) =>
      point.map((_, axis) => {
        let [sum, total] = [0, 0];
        weights.forEach((w, i) => {
          const other = frames[t + i - 3]?.find((h) => h.side === side);
          if (other) {
            sum += w * other.world[p][axis];
            total += w;
          }
        });
        return sum / total;
      }),
    );
  });
}

// One Euro, Casiez et al. 2012: cutoff rises with speed. Values follow FreeMoCap's defaults scaled to metres.
function euro(frames, side, fps, minCutoff = 1.0, beta = 10, dCutoff = 1.0) {
  const alpha = (cutoff) => 1 / (1 + (fps / (2 * Math.PI * cutoff)));
  let previous = null;
  let velocity = null;
  return frames.map((hands) => {
    const hand = hands.find((h) => h.side === side);
    if (!hand) {
      previous = null;
      velocity = null;
      return null;
    }
    if (!previous) {
      previous = hand.world.map((p) => [...p]);
      velocity = hand.world.map(() => [0, 0, 0]);
      return previous.map((p) => [...p]);
    }
    const smoothed = hand.world.map((point, p) =>
      point.map((value, axis) => {
        const rate = (value - previous[p][axis]) * fps;
        const aD = alpha(dCutoff);
        velocity[p][axis] = aD * rate + (1 - aD) * velocity[p][axis];
        const a = alpha(minCutoff + beta * Math.abs(velocity[p][axis]));
        return a * value + (1 - a) * previous[p][axis];
      }),
    );
    previous = smoothed.map((p) => [...p]);
    return smoothed;
  });
}

function write(path, method) {
  const left = method(data.frames, "Left", data.fps);
  const right = method(data.frames, "Right", data.fps);
  const frames = data.frames.map((_, t) => {
    const hands = [];
    if (left[t]) hands.push({ side: "Left", world: left[t] });
    if (right[t]) hands.push({ side: "Right", world: right[t] });
    return hands;
  });
  writeFileSync(path, JSON.stringify({ fps: data.fps, frames }));
}

write(gaussOut, gauss);
write(euroOut, euro);
