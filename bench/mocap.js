// One clip from video to animation files: GEM-X body with contact IK, SAM 3D Body's fingers joined on, MediaPipe's face
// curves, then BVH, FBX (through Blender), Live Link Face CSV, import checks and a preview drawn on the video.
// Each step is skipped when its output is already there, so a stopped run continues. GEM-X and SAM 3D Body use the
// graphics card, which is shared: message the other sessions first. ComfyUI must already be running on port 8199 with
// --extra-model-paths-config bench/comfy_paths.yaml (see run_full.js).
// Run: node mocap.js <clip in in/> [finger smoothing none|default|strong]
import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [clip, smoothing = "default"] = process.argv.slice(2);
if (!clip) throw new Error("usage: node mocap.js <clip in in/> [none|default|strong]");
const name = clip.replace(/\.[^.]+$/, "");
const video = join(root, "in", clip);
const take = join(root, "out", "take", name);
mkdirSync(take, { recursive: true });
const at = (file) => join(take, file);

const gemx = join(root, "gemx", "GEM-X");
const gemxPython = join(root, "gemx", ".venv", "Scripts", "python.exe");
const gemInfer = join(root, "gemx", ".venv", "Scripts", "gem-infer.exe");
const toolsPython = "E:/Dev/3D/just-stage/.dev/venv-tools/Scripts/python.exe"; // MediaPipe, JustStage's tool environment
const blender = "E:/blender-5.3.0-beta/blender.exe";
const cache = join(root, "gemx", "cache");
const env = { ...process.env, WARP_CACHE_PATH: join(cache, "warp"), HF_HOME: join(cache, "hf"), TMP: join(cache, "tmp"), TEMP: join(cache, "tmp") };

async function step(label, output, file, args, cwd = root) {
  if (output && existsSync(output)) return console.log(`${label}: already there`);
  const started = Date.now();
  try {
    const { stdout } = await run(file, args, { cwd, env, maxBuffer: 1 << 28 });
    const last = stdout.trim().split(/\r?\n/).filter((l) => !/warn/i.test(l)).slice(-3).join(" | ");
    console.log(`${label}: ${((Date.now() - started) / 1000).toFixed(0)} s  ${last}`);
  } catch (error) {
    console.error(`${label} failed:\n${String(error.stderr ?? error).split(/\r?\n/).slice(-15).join("\n")}`);
    process.exit(1);
  }
}

const { stdout: probe } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video]);
const seconds = Math.ceil(Number(probe.trim()));
const bench = (file) => join(root, "bench", file);

console.log("GEM-X and SAM 3D Body use the graphics card.");
await step("GEM-X body", at("gem.pt"), gemInfer, ["motion-video", "--task", "body", "--input", video, "--config", "weights/body_video_native77_static.yaml", "--start", "0", "--duration", String(seconds), "--device", "cuda", "--postprocess", "--soma-assets", "assets/soma", "--output", at("gem.pt")], gemx);
const mesh = join(root, "out", "mocap", `${name}-b8-mhr.npz`);
if (!existsSync(mesh)) {
  const up = await fetch("http://127.0.0.1:8199/system_stats").then((r) => r.ok, () => false);
  if (!up) throw new Error("ComfyUI is not running on port 8199; start it as run_full.js describes, then run this again");
}
await step("SAM 3D Body", mesh, process.execPath, [bench("run_full.js"), clip, "8", "1", "0", "1"], join(root, "bench"));
await step("head points", at("head2d.json"), gemxPython, [bench("gem_head2d.py"), at("gem.pt"), at("head2d.json")], gemx);
await step("face", at("face.json"), toolsPython, [bench("mp_face.py"), video, join(root, "models", "face_landmarker.task"), at("head2d.json"), at("face.json")]);
await step("join fingers", at("join.npz"), gemxPython, [bench("join_fingers.py"), at("gem.pt"), mesh, at("join.json"), "1", "-", "frame", smoothing], gemx);
await step("export", at(`${name}.bvh`), gemxPython, [bench("export_mocap.py"), at("join.npz"), at(name), at("face.json")], gemx);
const blend = (script, ...args) => ["--background", "--factory-startup", "--python", join(root, "bench", "blender", script), "--", ...args];
await step("FBX", at(`${name}.fbx`), blender, blend("bvh_to_fbx.py", at(`${name}.bvh`), at(`${name}.fbx`)));
for (const kind of ["bvh", "fbx"]) {
  await step(`read back in Blender, ${kind}`, null, blender, blend("bone_points.py", at(`${name}.${kind}`), at(`check_${kind}.json`)));
  await step(`check ${kind}`, null, gemxPython, [bench("check_import.py"), at(`${name}_joints.npz`), at(`check_${kind}.json`)]);
}
await step("preview", at(`${name}_preview.mp4`), gemxPython, [bench("preview_export.py"), at("join.npz"), at("gem.pt"), at(name), video, "30,90,150,210"], gemx);
console.log(`done: ${take}`);
