// RTMW through ONNX Runtime the way the kit runs it: onnxruntime-node with DirectML, no Python. Top-down on the person box,
// whole pipeline timed: decode, crop, inference, decode of the keypoints. Writes hand keypoints with their scores.
// Run: node rtmw_onnx.js <model.onnx> <clip.mp4> <boxes.json> <out.json> [dml|cpu]
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const [modelPath, clip, boxesPath, outPath, provider = "dml"] = process.argv.slice(2);
const ort = (await import("file:///E:/Dev/Web/just-house-paint/node_modules/onnxruntime-node/dist/index.js")).default;

const { width, height, boxes } = JSON.parse(readFileSync(boxesPath, "utf8"));
const session = await ort.InferenceSession.create(modelPath, {
  executionProviders: provider === "dml" ? ["dml"] : ["cpu"],
  enableMemPattern: provider !== "dml",
  executionMode: "sequential",
});
const input = session.inputNames[0];
const outputs = session.outputNames;
console.log("inputs", session.inputNames, "outputs", outputs);

const mean = [123.675, 116.28, 103.53];
const std = [58.395, 57.12, 57.375];
const [netW, netH] = modelPath.includes("256") ? [192, 256] : [288, 384];
const splitRatio = 2;

function crop(frame, box) {
  // RTMPose's top-down input: the box widened to the network's aspect ratio, sampled bilinearly.
  const [x0, y0, x1, y1] = box;
  const centre = [(x0 + x1) / 2, (y0 + y1) / 2];
  let [boxW, boxH] = [x1 - x0, y1 - y0];
  const aspect = netW / netH;
  if (boxW > boxH * aspect) boxH = boxW / aspect;
  else boxW = boxH * aspect;
  const [left, top] = [centre[0] - boxW / 2, centre[1] - boxH / 2];
  const tensor = new Float32Array(3 * netW * netH);
  for (let y = 0; y < netH; y += 1) {
    const sy = Math.min(height - 1, Math.max(0, top + ((y + 0.5) * boxH) / netH - 0.5));
    const iy = Math.floor(sy);
    const fy = sy - iy;
    const iy1 = Math.min(height - 1, iy + 1);
    for (let x = 0; x < netW; x += 1) {
      const sx = Math.min(width - 1, Math.max(0, left + ((x + 0.5) * boxW) / netW - 0.5));
      const ix = Math.floor(sx);
      const fx = sx - ix;
      const ix1 = Math.min(width - 1, ix + 1);
      for (let c = 0; c < 3; c += 1) {
        const a = frame[(iy * width + ix) * 3 + c];
        const b = frame[(iy * width + ix1) * 3 + c];
        const d = frame[(iy1 * width + ix) * 3 + c];
        const e = frame[(iy1 * width + ix1) * 3 + c];
        const value = (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy;
        tensor[c * netW * netH + y * netW + x] = (value - mean[c]) / std[c];
      }
    }
  }
  return { tensor, left, top, scale: boxW / netW };
}

function argmax(data, start, length) {
  let best = 0;
  let value = -Infinity;
  for (let i = 0; i < length; i += 1) {
    if (data[start + i] > value) {
      value = data[start + i];
      best = i;
    }
  }
  return [best, value];
}

const ffmpeg = spawn("ffmpeg", ["-v", "error", "-i", clip, "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]);
const frameSize = width * height * 3;
let buffer = Buffer.alloc(0);
const results = [];
let index = 0;
let cropMs = 0;
let inferMs = 0;
let decodeMs = 0;
const started = performance.now();
for await (const chunk of ffmpeg.stdout) {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= frameSize) {
    const frame = buffer.subarray(0, frameSize);
    const box = boxes[index] ?? [0, 0, width, height];
    const t0 = performance.now();
    const { tensor, left, top, scale } = crop(frame, box);
    const t1 = performance.now();
    const output = await session.run({ [input]: new ort.Tensor("float32", tensor, [1, 3, netH, netW]) });
    const t2 = performance.now();
    const simX = output[outputs[0]];
    const simY = output[outputs[1]];
    const count = simX.dims[1];
    const [widthX, widthY] = [simX.dims[2], simY.dims[2]];
    const points = [];
    for (let k = 0; k < count; k += 1) {
      const [px, sx] = argmax(simX.data, k * widthX, widthX);
      const [py, sy] = argmax(simY.data, k * widthY, widthY);
      points.push([left + (px / splitRatio) * scale, top + (py / splitRatio) * scale, Math.min(sx, sy)]);
    }
    const t3 = performance.now();
    if (index > 2) {
      cropMs += t1 - t0;
      inferMs += t2 - t1;
      decodeMs += t3 - t2;
    }
    results.push(points);
    buffer = buffer.subarray(frameSize);
    index += 1;
  }
}
const measured = Math.max(index - 3, 1);
const total = (performance.now() - started) / index;
writeFileSync(outPath, JSON.stringify({ width, height, frames: results }));
console.log(`${index} frames on ${provider}: inference ${(inferMs / measured).toFixed(1)} ms, crop ${(cropMs / measured).toFixed(1)} ms, keypoint decode ${(decodeMs / measured).toFixed(1)} ms, whole loop ${total.toFixed(1)} ms a frame`);
