// The camera lens GEM-X is told about. Without one, GEM-X takes the focal length as the image diagonal (body_video.py,
// motion_intrinsics), a 43 mm equivalent; a phone's main camera is about 24-28 mm. On Panoptic's undistorted walks the
// real focal length brought GEM-X's world path 5-10 mm closer and its camera-space path about twice as close, with pose
// 1-2 mm worse (RESEARCH.md, 2026-11-04). The 35 mm equivalent is taken along the frame's diagonal, as 35 mm
// equivalents are defined (43.27 mm on 35 mm film), so a phone's photo figure is only near for a 16:9 video.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
export const FULL_FRAME_DIAGONAL_MM = Math.hypot(36, 24);

// iPhone videos carry AVFoundation's quicktimeMetadataKeyCameraFocalLength35mmEquivalent ("26.00mm") from iOS 26, on the
// video track. ffprobe shows file-level keys; whether it shows this track-level one is untested without an iPhone file.
export async function focalTag(file) {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format_tags:stream_tags", "-of", "json", file]);
  const data = JSON.parse(stdout);
  for (const tags of [data.format?.tags ?? {}, ...(data.streams ?? []).map((s) => s.tags ?? {})]) {
    for (const [key, value] of Object.entries(tags)) {
      if (/camera\.focal_length\.35mm_equivalent$/i.test(key)) return Number.parseFloat(value);
    }
  }
  return null;
}

// Webcams state their lens as a diagonal field of view (the Logitech C920: 78°); this is its 35 mm equivalent.
export function focal35FromFov(degrees) {
  if (!(Number.isFinite(degrees) && degrees > 0 && degrees < 180)) throw new Error(`the field of view must be degrees between 0 and 180, got ${degrees}`);
  return FULL_FRAME_DIAGONAL_MM / (2 * Math.tan((degrees * Math.PI) / 360));
}

// GEM-X's camera.intrinsics for a 35 mm equivalent focal length, principal point at the centre as GEM-X's own default.
export function lensFor(focal35, width, height, source) {
  if (focal35 === null || focal35 === undefined) return { source: "GEM-X's default: focal length = image diagonal" };
  if (!(Number.isFinite(focal35) && focal35 > 0)) throw new Error(`the focal length must be millimetres above 0, got ${focal35}`);
  const focal = Math.round(((focal35 * Math.hypot(width, height)) / FULL_FRAME_DIAGONAL_MM) * 100) / 100;
  return { source, focal35, intrinsics: [[focal, 0, width / 2], [0, focal, height / 2], [0, 0, 1]] };
}
