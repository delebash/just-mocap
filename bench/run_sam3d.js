// Drives SAM 3D Body through ComfyUI's API on one clip and records time and the card's peak memory.
// Run: node run_sam3d.js <tag> <batch> <hands 0|1> <seconds> [file] [start]
import { execFile } from "node:child_process";
import { appendFileSync } from "node:fs";
import { promisify } from "node:util";

const run = promisify(execFile);
const base = "http://127.0.0.1:8199";
const [tag, batch, hands, seconds, file = "woman_holding_water_glass.mp4", start = "0"] = process.argv.slice(2);

const viewport = { image: "", mask: "", normal: "", camera_info: {} };
const save = (model, prefix) => ({
  class_type: "Save3DAdvanced",
  inputs: { model_3d: model, filename_prefix: prefix, viewport_state: viewport, width: 512, height: 512 },
});
const pose = (data) => ({
  class_type: "BuildPoseFile",
  inputs: {
    pose_data: data,
    format: "bvh",
    "format.units": "cm",
    sam3d_body_model: ["6", 0],
    fps: 30,
    camera_translation: "off",
    track_index: 0,
  },
});
const prompt = {
  1: { class_type: "LoadVideo", inputs: { file } },
  2: { class_type: "Video Slice", inputs: { video: ["1", 0], start_time: Number(start), duration: Number(seconds), strict_duration: false } },
  3: { class_type: "GetVideoComponents", inputs: { video: ["2", 0] } },
  4: { class_type: "UNETLoader", inputs: { unet_name: "rt_detr_v4-x-hgnet_fp32.safetensors", weight_dtype: "default" } },
  5: { class_type: "RTDETR_detect", inputs: { model: ["4", 0], image: ["3", 0], threshold: 0.5, class_name: "person", max_detections: 1 } },
  6: { class_type: "SAM3DBody_Loader", inputs: { model_file: "sam_3d_body_dinov3_bf16.safetensors" } },
  7: {
    class_type: "SAM3DBody_Predict",
    inputs: { sam3d_body_model: ["6", 0], image: ["3", 0], bboxes: ["5", 0], run_hand_refinement: hands === "1", fov: 0, batch_size: Number(batch) },
  },
  8: { class_type: "SAM3DBody_Smooth", inputs: { mhr_pose_data: ["7", 0], strength: 1, method: "gaussian", window: 7, rotation_threshold_degrees: 15 } },
  9: pose(["7", 0]),
  10: save(["9", 0], `mocap/${tag}-raw`),
  11: pose(["8", 0]),
  12: save(["11", 0], `mocap/${tag}-smooth`),
};

const peak = { value: 0 };
const timer = setInterval(async () => {
  const { stdout } = await run("nvidia-smi", ["--query-gpu=memory.used", "--format=csv,noheader,nounits"]);
  peak.value = Math.max(peak.value, Number(stdout));
}, 1000);

const started = Date.now();
const posted = await fetch(`${base}/prompt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt }) });
const body = await posted.json();
if (!body.prompt_id) {
  console.log(JSON.stringify(body, null, 1).slice(0, 2500));
  clearInterval(timer);
  process.exit(1);
}
for (;;) {
  await new Promise((done) => setTimeout(done, 2000));
  const history = await (await fetch(`${base}/history/${body.prompt_id}`)).json();
  const entry = history[body.prompt_id];
  if (!entry) continue;
  clearInterval(timer);
  const elapsed = (Date.now() - started) / 1000;
  const status = entry.status?.status_str;
  const line = { tag, batch: Number(batch), hands: hands === "1", seconds: Number(seconds), status, elapsed, peakMiB: peak.value };
  console.log(JSON.stringify(line));
  if (status !== "success") console.log(JSON.stringify(entry.status?.messages?.at(-1)).slice(0, 1800));
  appendFileSync(new URL("./runs.jsonl", import.meta.url), `${JSON.stringify(line)}\n`);
  break;
}
