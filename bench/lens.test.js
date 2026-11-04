// Run: node --test bench/lens.test.js
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { focalTag, lensFor } from "./lens.js";

const run = promisify(execFile);
const sample = fileURLToPath(new URL("../in/pan_walk4648.mp4", import.meta.url));

test("Panoptic camera 00_07: its 27.4 mm equivalent gives its calibrated focal length", () => {
  // Calibration: fx 1395.68, fy 1392.29 on 1920x1080, so 1394 px on a 2203 px diagonal is 27.38 mm.
  const lens = lensFor(27.38, 1920, 1080, "test");
  assert.ok(Math.abs(lens.intrinsics[0][0] - 1394) < 1, `got ${lens.intrinsics[0][0]}`);
  assert.deepEqual([lens.intrinsics[0][2], lens.intrinsics[1][2]], [960, 540]);
});

test("no focal length leaves GEM-X's default, a bad one stops", () => {
  assert.equal(lensFor(null, 1920, 1080).intrinsics, undefined);
  assert.throws(() => lensFor(0, 1920, 1080, "test"));
  assert.throws(() => lensFor(Number.NaN, 1920, 1080, "test"));
});

test("the 35 mm equivalent tag is read from a video, and its absence gives null", async () => {
  // The repo's own tmp folder, never the system one (it is on C:).
  const scratch = fileURLToPath(new URL("../tmp/", import.meta.url));
  mkdirSync(scratch, { recursive: true });
  const dir = mkdtempSync(join(scratch, "lens-"));
  try {
    const tagged = join(dir, "tagged.mov");
    await run("ffmpeg", ["-v", "error", "-y", "-i", sample, "-t", "0.2", "-c", "copy", "-movflags", "use_metadata_tags", "-metadata", "com.apple.quicktime.camera.focal_length.35mm_equivalent=26.00mm", tagged]);
    assert.equal(await focalTag(tagged), 26);
    assert.equal(await focalTag(sample), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
