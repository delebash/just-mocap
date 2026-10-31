// Draws SAM 3D Body's smoothed skeleton, hands included, over the source frames so the result can be judged by eye.
// The same OpenPose-style render is what a pose guide for LTX would use. Run: node render_sam3d.js <tag> <seconds>
const base = "http://127.0.0.1:8199";
const [tag, seconds, file = "woman_holding_water_glass.mp4"] = process.argv.slice(2);

const prompt = {
  1: { class_type: "LoadVideo", inputs: { file } },
  2: { class_type: "Video Slice", inputs: { video: ["1", 0], start_time: 0, duration: Number(seconds), strict_duration: false } },
  3: { class_type: "GetVideoComponents", inputs: { video: ["2", 0] } },
  4: { class_type: "UNETLoader", inputs: { unet_name: "rt_detr_v4-x-hgnet_fp32.safetensors", weight_dtype: "default" } },
  5: { class_type: "RTDETR_detect", inputs: { model: ["4", 0], image: ["3", 0], threshold: 0.5, class_name: "person", max_detections: 1 } },
  6: { class_type: "SAM3DBody_Loader", inputs: { model_file: "sam_3d_body_dinov3_bf16.safetensors" } },
  7: { class_type: "SAM3DBody_Predict", inputs: { sam3d_body_model: ["6", 0], image: ["3", 0], bboxes: ["5", 0], run_hand_refinement: true, fov: 0, batch_size: 4 } },
  8: { class_type: "SAM3DBody_Smooth", inputs: { mhr_pose_data: ["7", 0], strength: 1, method: "gaussian", window: 7, rotation_threshold_degrees: 15 } },
  9: {
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
  },
  10: { class_type: "SaveImage", inputs: { images: ["9", 0], filename_prefix: `mocap/${tag}/f` } },
};

const posted = await fetch(`${base}/prompt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt }) });
const body = await posted.json();
if (!body.prompt_id) {
  console.log(JSON.stringify(body, null, 1).slice(0, 2500));
  process.exit(1);
}
for (;;) {
  await new Promise((done) => setTimeout(done, 2000));
  const history = await (await fetch(`${base}/history/${body.prompt_id}`)).json();
  const entry = history[body.prompt_id];
  if (!entry) continue;
  console.log(entry.status?.status_str, JSON.stringify(entry.status?.messages?.at(-1)).slice(0, 1200));
  break;
}
