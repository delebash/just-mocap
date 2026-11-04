// One honest run of SAM 3D Body on one clip: models unloaded first, each stage timed from ComfyUI's own events, the card
// sampled every 250 ms. Writes raw and smoothed BVH with the root path on, and an overlay to look at.
// mesh 1 also saves the raw per-frame MHR mesh and parameters to an .npz; ComfyUI must be started with
// --extra-model-paths-config bench/comfy_paths.yaml so the save node loads.
// track 1 follows the person through the clip with SAM 3.1 video tracking, as ComfyUI's own SAM 3D Body template
// (utility_sam3d_body.json: "For multiple people in same clip SAM3 is practically required"). It needs
// sam3.1_multiplex_fp16.safetensors in ComfyUI's models/checkpoints. Track 0 is exported; without tracking, RT-DETR's
// one box a frame can jump to another person.
// Run: node run_full.js <clip.mp4> <batch> [hands 1|0] [overlay 1|0] [mesh 1|0] [track 1|0]
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { promisify } from "node:util";

const run = promisify(execFile);
const base = "127.0.0.1:8199";
const [file, batch, hands = "1", overlay = "1", mesh = "0", track = "0"] = process.argv.slice(2);
const tag = `${file.replace(/\.[^.]+$/, "")}-b${batch}${hands === "1" ? "" : "-body"}${track === "1" ? "-track" : ""}`;

await fetch(`http://${base}/free`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ unload_models: true, free_memory: true }) });
await new Promise((done) => setTimeout(done, 4000));

const viewport = { image: "", mask: "", normal: "", camera_info: {} };
const save = (model, prefix) => ({ class_type: "Save3DAdvanced", inputs: { model_3d: model, filename_prefix: prefix, viewport_state: viewport, width: 512, height: 512 } });
const pose = (data) => ({
  class_type: "BuildPoseFile",
  inputs: { pose_data: data, format: "bvh", "format.units": "cm", sam3d_body_model: ["6", 0], fps: 30, camera_translation: "centered", track_index: 0 },
});
const prompt = {
  1: { class_type: "LoadVideo", inputs: { file } },
  3: { class_type: "GetVideoComponents", inputs: { video: ["1", 0] } },
  4: { class_type: "UNETLoader", inputs: { unet_name: "rt_detr_v4-x-hgnet_fp32.safetensors", weight_dtype: "default" } },
  5: { class_type: "RTDETR_detect", inputs: { model: ["4", 0], image: ["3", 0], threshold: 0.5, class_name: "person", max_detections: 1 } },
  6: { class_type: "SAM3DBody_Loader", inputs: { model_file: "sam_3d_body_dinov3_bf16.safetensors" } },
  7: { class_type: "SAM3DBody_Predict", inputs: { sam3d_body_model: ["6", 0], image: ["3", 0], bboxes: ["5", 0], run_hand_refinement: hands === "1", fov: 0, batch_size: Number(batch) } },
  8: { class_type: "SAM3DBody_Smooth", inputs: { mhr_pose_data: ["7", 0], strength: 1, method: "savgol", window: 7, rotation_threshold_degrees: 30 } },
  9: pose(["7", 0]),
  10: save(["9", 0], `mocap/${tag}-raw`),
  11: pose(["8", 0]),
  12: save(["11", 0], `mocap/${tag}-smooth`),
};
if (overlay === "1") {
  prompt[13] = {
    class_type: "SAM3DBody_Render",
    inputs: {
      pose_data: ["8", 0],
      background: ["3", 0],
      width: 0,
      height: 0,
      render_style: "openpose_2d",
      "render_style.marker_radius_px": 3,
      "render_style.stick_width_px": 2,
      "render_style.limb_alpha": 0.8,
      "render_style.face_style": "disabled",
      "render_style.hand_style": "openpose",
      "render_style.person_palette_falloff": 0.6,
    },
  };
  prompt[14] = { class_type: "SaveImage", inputs: { images: ["13", 0], filename_prefix: `mocap/${tag}/f` } };
}
if (mesh === "1") prompt[15] = { class_type: "JustMocapSaveMHR", inputs: { mhr_pose_data: ["7", 0], filename_prefix: `mocap/${tag}-mhr` } };
if (track === "1") {
  // The template's wiring and settings: SAM 3.1 with the prompt "person", RT-DETR at up to 100 boxes, both into Predict.
  prompt[16] = { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sam3.1_multiplex_fp16.safetensors" } };
  prompt[17] = { class_type: "CLIPTextEncode", inputs: { clip: ["16", 1], text: "person" } };
  prompt[18] = { class_type: "SAM3_VideoTrack", inputs: { images: ["3", 0], model: ["16", 0], conditioning: ["17", 0], detection_threshold: 0.5, max_objects: 4, detect_interval: 1 } };
  prompt[5].inputs.max_detections = 100;
  prompt[7].inputs.track_data = ["18", 0];
}
const names = { 1: "load", 3: "decode", 4: "detector load", 5: "detect", 6: "sam load", 7: "predict", 8: "smooth", 9: "bvh raw", 11: "bvh smooth", 13: "render", 14: "save images", 16: "sam3 load", 18: "track" };

const clientId = randomUUID();
const socket = new WebSocket(`ws://${base}/ws?clientId=${clientId}`);
await new Promise((done) => socket.addEventListener("open", done));

let peak = 0;
const sampler = setInterval(async () => {
  const { stdout } = await run("nvidia-smi", ["--query-gpu=memory.used", "--format=csv,noheader,nounits"]);
  peak = Math.max(peak, Number(stdout));
}, 250);

const marks = [];
const started = Date.now();
const finished = new Promise((done) => {
  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    const { type, data } = JSON.parse(event.data);
    if (type === "executing") {
      marks.push({ node: data.node, at: Date.now() });
      if (data.node === null) done("success");
    } else if (type === "execution_error") {
      console.log(JSON.stringify(data).slice(0, 900));
      done("error");
    }
  });
});
const posted = await (await fetch(`http://${base}/prompt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt, client_id: clientId }) })).json();
if (!posted.prompt_id) {
  console.log(JSON.stringify(posted).slice(0, 1500));
  process.exit(1);
}
const status = await finished;
clearInterval(sampler);
socket.close();

const stages = {};
marks.forEach((mark, i) => {
  if (mark.node === null || !marks[i + 1]) return;
  stages[names[mark.node] ?? mark.node] = (marks[i + 1].at - mark.at) / 1000;
});
const line = { tag, status, totalSeconds: (Date.now() - started) / 1000, peakMiB: peak, stages };
console.log(JSON.stringify(line));
appendFileSync(new URL("./runs.jsonl", import.meta.url), `${JSON.stringify(line)}\n`);
process.exit(0);
