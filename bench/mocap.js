// One clip from video to animation files: GEM-X body with contact IK, SAM 3D Body's fingers joined on, MediaPipe's face
// curves, then BVH, FBX (through Blender), Live Link Face CSV, import checks and a preview drawn on the video.
// Each step is skipped when its output is already there, so a stopped run continues. GEM-X and SAM 3D Body use the
// graphics card, which is shared: message the other sessions first. ComfyUI must already be running on port 8199 with
// --output-directory out and --extra-model-paths-config bench/comfy_paths.yaml (see run_full.js).
// Every step reads one 30 fps copy of the clip, made by GEM-X's own converter, because GEM-X works at 30 fps and the
// finger join needs the same frames from both models; a 60 or 29.97 fps phone clip would otherwise not line up.
// SAM 3D Body runs in pieces sized to the frame: ComfyUI decodes a video into 32-bit floats, about 30 GB for 10 s of 4K.
// The lens (bench/lens.js): --focal35 <mm>, the phone's 35 mm equivalent, or else the video's own tag where an iPhone wrote
// one, or else GEM-X's default. It is kept in lens.json beside gem.pt, and a different lens on an existing gem.pt stops.
// Run: node mocap.js <clip in in/> [finger smoothing none|default|strong] [--focal35 <mm>]
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { focalTag, lensFor } from "./lens.js";

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { values: options, positionals } = parseArgs({ allowPositionals: true, options: { focal35: { type: "string" } } });
const [clip, smoothing = "default"] = positionals;
if (!clip) throw new Error("usage: node mocap.js <clip in in/> [none|default|strong] [--focal35 <mm>]");
const name = clip.replace(/\.[^.]+$/, "");
const source = join(root, "in", clip);
const take = join(root, "out", "take", name);
mkdirSync(join(take, "sam"), { recursive: true });
const at = (file) => join(take, file);
const video = at("clip30.mp4");

const gemx = join(root, "gemx", "GEM-X");
const gemxPython = join(root, "gemx", ".venv", "Scripts", "python.exe");
const gemInfer = join(root, "gemx", ".venv", "Scripts", "gem-infer.exe");
const toolsPython = "E:/Dev/3D/just-stage/.dev/venv-tools/Scripts/python.exe"; // MediaPipe, JustStage's tool environment
const blender = "E:/blender-5.3.0-beta/blender.exe";
const cache = join(root, "gemx", "cache");
const env = { ...process.env, WARP_CACHE_PATH: join(cache, "warp"), HF_HOME: join(cache, "hf"), TMP: join(cache, "tmp"), TEMP: join(cache, "tmp") };
// Decoded frames per SAM 3D Body piece, in GB of 32-bit floats; the rest of RAM is left for the models and other sessions.
const PIECE_GB = 6;

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
  if (output && !existsSync(output)) {
    console.error(`${label} finished without writing ${output}`);
    process.exit(1);
  }
}
const bench = (file) => join(root, "bench", file);

const normalize = "import sys; from gem.inference.video import normalize_video; m = normalize_video(sys.argv[1], sys.argv[2])['normalized']; print(f\"{m['frame_count']} frames at {m['fps']:g} fps, {m['width']}x{m['height']}\")";
await step("30 fps copy", video, gemxPython, ["-c", normalize, source, video], gemx);
const { stdout: probe } = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries", "stream=width,height,nb_read_packets", "-of", "csv=p=0", video]);
const [width, height, frames] = probe.trim().split(",").map(Number);

const tagged = options.focal35 === undefined ? await focalTag(source) : null;
const lens = lensFor(options.focal35 === undefined ? tagged : Number(options.focal35), width, height, options.focal35 === undefined ? "the video's 35 mm equivalent tag" : "--focal35");
console.log(`lens: ${lens.source}${lens.intrinsics ? `, ${lens.focal35} mm equivalent, focal length ${lens.intrinsics[0][0]} px` : options.focal35 === undefined ? " (no focal tag in the video; --focal35 gives the phone's lens)" : ""}`);
const lensFile = at("lens.json");
const baseConfig = "weights/body_video_native77_static.yaml";
let gemConfig = baseConfig;
if (existsSync(at("gem.pt"))) {
  // A take made before lens.json existed used GEM-X's default.
  const before = existsSync(lensFile) ? JSON.parse(readFileSync(lensFile, "utf8")) : lensFor(null);
  if (JSON.stringify(before.intrinsics) !== JSON.stringify(lens.intrinsics)) {
    throw new Error(`${at("gem.pt")} was made with another lens (${before.source}); remove gem.pt and the files made after it to redo`);
  }
} else {
  writeFileSync(lensFile, JSON.stringify(lens, null, 1));
  if (lens.intrinsics) {
    // GEM-X's config with the lens added; load_body_video_config makes its model paths absolute, so it can live here.
    gemConfig = at("gemx_config.json");
    const write = "import json, sys; from gem.inference.body_video import load_body_video_config; c = load_body_video_config(sys.argv[1]); c.setdefault('camera', {})['intrinsics'] = json.loads(sys.argv[2]); json.dump(c, open(sys.argv[3], 'w'), indent=1); print('camera', c['camera'])";
    await step("GEM-X config with the lens", null, gemxPython, ["-c", write, baseConfig, JSON.stringify(lens.intrinsics), gemConfig], gemx);
  }
}

console.log("GEM-X and SAM 3D Body use the graphics card.");
await step("GEM-X body", at("gem.pt"), gemInfer, ["motion-video", "--task", "body", "--input", video, "--config", gemConfig, "--device", "cuda", "--postprocess", "--soma-assets", "assets/soma", "--output", at("gem.pt")], gemx);

const mesh = at("sam-mhr.npz");
if (!existsSync(mesh)) {
  const up = await fetch("http://127.0.0.1:8199/system_stats").then((r) => r.ok, () => false);
  if (!up) throw new Error("ComfyUI is not running on port 8199; start it as run_full.js describes, then run this again");
  const perPiece = Math.max(30, Math.floor((PIECE_GB * 2 ** 30) / (width * height * 3 * 4)));
  const pieces = [];
  for (let first = 0, i = 0; first < frames; first += perPiece, i++) {
    const last = Math.min(frames, first + perPiece);
    const tag = `p${String(i).padStart(2, "0")}`;
    const piece = join(take, "sam", `${tag}.mp4`);
    // Lossless, so SAM 3D Body sees exactly the 30 fps copy's frames.
    await step(`piece ${tag}, frames ${first}-${last - 1}`, piece, "ffmpeg", ["-v", "error", "-nostdin", "-y", "-i", video, "-vf", `trim=start_frame=${first}:end_frame=${last},setpts=PTS-STARTPTS`, "-c:v", "libx264", "-qp", "0", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-an", piece]);
    // ComfyUI reads it from its output folder (the "[output]" annotation) and saves under out/mocap/<same path>.
    const saved = join(root, "out", "mocap", "take", name, "sam", `${tag}-b8-mhr.npz`);
    await step(`SAM 3D Body ${tag}`, saved, process.execPath, [bench("run_full.js"), `take/${name}/sam/${tag}.mp4 [output]`, "8", "1", "0", "1"], join(root, "bench"));
    pieces.push(saved);
  }
  await step("join SAM 3D Body pieces", mesh, gemxPython, [bench("concat_mhr.py"), mesh, String(frames), ...pieces]);
}
await step("head points", at("head2d.json"), gemxPython, [bench("gem_head2d.py"), at("gem.pt"), at("head2d.json")], gemx);
await step("face", at("face.json"), toolsPython, [bench("mp_face.py"), video, join(root, "models", "face_landmarker.task"), at("head2d.json"), at("face.json")]);
await step("join fingers", at("join.npz"), gemxPython, [bench("join_fingers.py"), at("gem.pt"), mesh, at("join.json"), "1", "-", "frame", smoothing, "arm"], gemx);
await step("export", at(`${name}.bvh`), gemxPython, [bench("export_mocap.py"), at("join.npz"), at(name), at("face.json")], gemx);
const blend = (script, ...args) => ["--background", "--factory-startup", "--python", join(root, "bench", "blender", script), "--", ...args];
await step("FBX", at(`${name}.fbx`), blender, blend("bvh_to_fbx.py", at(`${name}.bvh`), at(`${name}.fbx`)));
for (const kind of ["bvh", "fbx"]) {
  await step(`read back in Blender, ${kind}`, null, blender, blend("bone_points.py", at(`${name}.${kind}`), at(`check_${kind}.json`)));
  await step(`check ${kind}`, null, gemxPython, [bench("check_import.py"), at(`${name}_joints.npz`), at(`check_${kind}.json`)]);
}
await step("preview", at(`${name}_preview.mp4`), gemxPython, [bench("preview_export.py"), at("join.npz"), at("gem.pt"), at(name), video, "30,90,150,210"], gemx);
console.log(`done: ${take}`);
