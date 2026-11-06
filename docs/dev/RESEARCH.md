# Research

The research is in the kit repo: `../just-core/docs/plans/2026-10-31-just-direct-research-mocap.md`, with its notes and query logs in the folder beside it.
Section 9 there holds the first measured numbers. New measured results land here, one block per run, with the clip named.

**Section 10 of that file is the audit: fifteen corrections, clean timings, matched-joint jitter on all clips, and the recommendations that survived. It replaces the numbers below where they differ.**

## Measured

Card: RTX 2070 SUPER 8 GB, 32 GB RAM. Raw runs are in `bench/runs.jsonl`.

### 2026-11-05, GEM-X's person and the floor plant in `mocap.js`, card used

**Guitarist, `node bench/mocap.js subway_guitar_busker.mp4`** (1280×720, 24 fps, so 151 frames in the 30 fps copy; GEM-X's default lens). It ran end to end:
- GEM-X 147 s.
- Floor plant 6 s: 151 frames with a firm foot contact, offset -0.007 to +0.010 m.
- GEM-X's boxes: seen in 151 frames, filled in 0.
- SAM 3D Body 64 s (predict 47.8 s, detect 10.0 s at up to 100 boxes), peak 5,092 MiB.
- Face found in 123 of 151 frames; finger join mesh fit 5.0 mm.
- BVH and FBX read back in Blender at 0.001 and 0.002 mm.

**The person node** (`bench/comfy_nodes/just_mocap_person.py`, ComfyUI log): GEM-X's person was RT-DETR's top box in 137 frames and another box in 14. It was found in every frame.

**Root jumps** per frame of SAM 3D Body's raw BVH, on the same 30 fps piece (`bvh_root_jumps.py`, scratch):
- One box, `node run_full.js "take/subway_guitar_busker/sam/p00.mp4 [output]" 8 1 1 0`: median 2.1 cm, max 228.8 cm. Nine steps are over 10 cm, at frames 5, 8, 14, 19, 20, 21, 23, 28 and 30.
- With GEM-X's person: median 2.1 cm, max 4.8 cm, none over 10. The tracking run of 2026-11-04 on the 24 fps original reached at most 5.0 cm.
- Both took 64 s, against 228 s with SAM 3.1 tracking.

Comparing the two runs frame by frame, they differ widely in exactly 14 frames: 5-13, 19, 21, 22, 28 and 29, where the one-box run had a passer-by. Elsewhere they differ by at most 0.13 cm and 0.6° per channel, except frame 129, where two joints along one arm (`joint_077` and `joint_078`) differ by 40° and 95°.

A second one-box run (`... 8 1 0 0`) differs from the first only at frame 129: `joint_078` by 94.7°, measured as a true rotation angle. There the person run matches the second run. So SAM 3D Body isn't repeatable at that frame. Outside the 14 passer-by frames, the person run equals the one-box run within SAM 3D Body's own run-to-run difference.

By eye, on the preview every 25 frames (0-150), the skeleton is on the guitarist in all seven.

**The fretting hand is drawn off its fingers** at frames 75 and 125; the strumming hand sits on its fingers. To find the layer, I compared the wrist in pixels as GEM-X's own 2D input points saw it (`conditions.kp2d_native77`, confidence 0.92), as SAM 3D Body projects it (its camera, `comfy/ldm/sam3d_body/model/model.py:955-964`), and as the joined skeleton projects it (`hand_layers.py`, scratch):
- GEM-X's own left wrist is a median 40 px (p90 94) from its own 2D point. It's the same in `raw_predictions`, after GEM-X's post-process and after the floor plant.
- Its right wrist is 8 px off (p90 23). SAM 3D Body's left wrist is 12 px off (p90 27).
- The join puts the hand at GEM-X's wrist, so the joined hand carries GEM-X's error. The layer is GEM-X's model on this clip; the person pick, the plant and the join didn't cause it.
- On `test60_2338` (Panoptic, 1920×1080), the joined wrists are 20 px from GEM-X's 2D points on both sides, and SAM 3D Body's 8-12 px.
- GEM-X's motion post-process has no 2D refit (searched `gem/` for reproj, refine, smplify, fit_2d).
- On Panoptic's measured arms, GEM-X's arms and shoulders beat SAM 3D Body's on all four clips (17-28 mm against 25-38 mm, 2026-10-31 below). Simply taking SAM 3D Body's arm would undo that.
- Recipe item 3 of the research ("Join the wrist with forearm IK and gates … Fall back to the body's wrist", research file line 42) was never built: the join always falls back to GEM-X's wrist.
- Untested so far: the lens. The clip has no focal tag, so GEM-X used its default (focal length = image diagonal). The fretting hand is reached toward the camera, where a wrong focal length moves the projection most.

**Walk 4648, `node bench/mocap.js pan_walk4648.mp4`**, the full chain with the floor plant on and GEM-X's person (1920×1080, 300 frames, GEM-X's default lens). It ran end to end:
- GEM-X 277 s.
- Floor plant 7 s: 289 frames with a firm foot contact, offset -0.296 to -0.001 m.
- GEM-X's boxes seen in 300 frames, filled in 0.
- SAM 3D Body in two pieces (258 and 42 frames), 105 and 26 s, peak 5,048 MiB. GEM-X's person was RT-DETR's top box in all 300 frames.
- Finger join mesh fit 6.0 mm. Face found in 49 of 300 frames (the head is small and often turned away).
- BVH and FBX read back at 0.002 mm.

By eye, the preview sheet (frames 30, 90, 150 and 210) has the skeleton on the walker in all four.

**Tests, all green:**
- `node --test bench/lens.test.js`: 4 of 4.
- `bench/just_mocap_person_test.py`: 6 of 6.
- `bench/floor_plant_test.py`: 2 of 2.

### 2026-11-05, the two open decisions re-attacked from code and past runs, no card used

**Correction to the floor plant's keep-test result below.** It said "floor, pose and jerk pass". The table's Accel column, acceleration error against the truth (`truth_body.js:4`), is worse in all six runs, by 0.6-1.2% (7.20→7.27, 7.57→7.63, 7.46→7.55, 9.38→9.45, 9.01→9.06, 11.07→11.19). So the plant misses the approved test on two counts, foot slide and acceleration, plus the bob.

**Floor plant, failure cases found in `bench/floor_plant.py`:**
- Under two frames with a firm foot contact, it exits (line 67). Inside `mocap.js` that would stop the whole run, for example on a waist-up take with the feet out of frame. Whether GEM-X marks out-of-frame feet as firm is unmeasured.
- The Whittaker-Henderson fit (lines 43-49) penalises only second differences. Where no frame has weight, the solution runs on as a straight line. So after the last firm contact, and before the first, the offset keeps the slope of the last few firm frames to the clip's end. Example: a take that ends sitting or lying down. Only walks were measured, where contact is firm throughout.
- Who reads `gem.pt` in `mocap.js`:
  - `gem_head2d.py` reads `conditions.kp2d_native77`, which the plant doesn't change;
  - `preview_export.py:41` reads `conditions.K_fullimg`, also unchanged;
  - `join_fingers.py:173-174` reads both `pred_soma_params_incam` and `pred_soma_params_global`, which the plant writes.

  So only the join needs the planted file.

**How other mocap apps handle the floor**:
- "DeepMotion Animate 3D foot locking option default" led to [DeepMotion's Animate 3D REST API](https://github.com/DeepMotion/Animate-3D-REST-API) (read). `footLockingMode`'s default is `auto`: "default mode, automatic switching between locking and gliding modes of the foot, recommended for general cases". `never` is "forced to disable foot locking and character grounding", and `grounding` is "forced disabling foot locking, however character is still grounded".
- [DeepMotion's foot locking guide](https://deepmotion.com/article/foot-locking) (read) recommends Never "for motions that are completely in the air or in water".
- "QuickMagic AI mocap foot lock ground contact setting": no QuickMagic documentation of a setting was found, only reviews praising its foot planting (unread beyond the search snippets).
- [Reallusion Motion LIVE 2D's height page](https://manual.reallusion.com/Motion_LIVE_2D_Plugin/Resources/CTA_4/Plugins/Motion_Live_2D/Dynamically_Adjusting_Height.htm) (read): "By default, the effective Floor Contact for Feet and Hands gives the power to capture 2D character's ground motions", with a Ground slider for the floor height.

So keeping the character on the floor by default, with a switch to turn it off, is what these apps do. Our plant is like DeepMotion's `grounding`: root height only, no foot lock.

**Tracking, facts from ComfyUI's code and `bench/runs.jsonl`:**
- With `track_data`, `SAM3DBody_Predict` ignores the `bboxes` input ("Precedence: SAM3 track (masks + boxes) > detector boxes", `comfy_extras/nodes_sam3d_body.py:179-185`). So the template's 100-box RT-DETR run goes unused.
- It runs every tracked object in every frame (`nodes_sam3d_body.py:205-234`), and an object whose mask is empty that frame gets the full frame as its box (`comfy_extras/sam3d_body/utils.py:37-38`).
- On the guitarist, predict took 38.7 s with one box and 155.8 s with tracking (4.0×); the whole run took 52.5 and 227.7 s (`runs.jsonl` lines 11 and 29).
- Our save node keeps each frame's first person (`bench/comfy_nodes/just_mocap_save.py:38-46`).
- GEM-X already tracks its person: YOLOX boxes, ByteTrack, and the track with the largest summed box area, gaps filled by interpolation (`gem/common/detectors/tracks.py:52-136`). `gem.pt` keeps only the enlarged square box (`conditions.bbx_xys`) and the person's 77 2D points with confidence (`conditions.kp2d_native77`).
- Predict also takes per-frame boxes as an alternative to tracking (`bboxes`, `nodes_sam3d_body.py:146-151`). SAM 3D Body pads the box 1.25× to a 0.75 aspect (`comfy/ldm/sam3d_body/utils.py:106-136`). So GEM-X's square box, already 1.2× larger, would give a crop about 1.33× larger than RT-DETR's tight box on a standing person.
- Where SAM 3D Body finds no person, `join_fingers.py` keeps GEM-X's own hands for that frame (`found`, lines 66 and 152).

### 2026-11-04, PoseInversion autograd refinement, moving camera and lens

**The GEM-X drift issue was not posted.** Claude Code's permission check denied `gh issue create` as a public action. No new GEM-X issue covers it: the 28 titles are the same as on 2026-11-03.

Checked against the data, the first draft's hip numbers were loose ("drops 20 cm and 24 cm" read 10 samples). The measure is the hip midpoint's y in `pred_soma_params_global` minus `raw_predictions`. It equals the `transl` change, since `correct_static_pose` only replaces `body_pose`.

The text below replaces the 2026-11-03 draft. It uses all six runs below, including the calibrated lens, since every earlier run had the wrong focal length and a distorted image. Title: "Contact post-process sums vertical joint motion into the root: planted feet drift up to 30 cm over 10 s".

```markdown
With `--postprocess`, `correct_static_translation` (gem/motion/postprocess/contact.py:157-166) rebuilds the root path as the running sum of root displacement minus the contact-weighted displacement of the static-flagged joints, in all three axes. Then x and z are smoothed, and y gets a single `ground_y` offset for the whole clip. So any vertical motion of a joint flagged static (heel roll, toe-off, prediction noise) adds up in the root height and is never pulled back.

Measured on CMU Panoptic `171204_pose1`, HD camera 00_07, two 10 s walks (frames 4648-4947 and 13858-14157), commit 20555be (`contact.py` is unchanged on main, 4aef145). Three inputs per walk:
- the original 1080p video with the default intrinsics;
- the same video undistorted with Panoptic's calibration, with the calibrated `camera.intrinsics`;
- a 1280x720 virtual camera turning up to 13° to follow the person, drawn from the calibrated view by a rotation homography, with `camera.mode: background`.

Range of planted ankle heights in the world output, mm. These are the stances where the measured ankle sits at its planted height, with no alignment:

| Walk, input | Measured | No post-process | Post-process | Post-process keeping the raw y |
|---|---|---|---|---|
| 4648, original | 17 | 199 | 302 | 201 |
| 4648, calibrated | 17 | 271 | 299 | 272 |
| 4648, turning camera | 17 | 163 | 288 | 165 |
| 13858, original | 31 | 94 | 289 | 95 |
| 13858, calibrated | 31 | 162 | 287 | 161 |
| 13858, turning camera | 31 | 72 | 259 | 73 |

The hip-height change from the post-process (post minus raw), first to last half-second: -14, -4, -17, -23, -18 and -21 cm.

"Keeping the raw y" takes `correct_static_translation`'s x and z, keeps the raw root height (lowered once so the lowest joint sits at 0), then runs `correct_static_pose` unchanged. It brings the floor range back to the raw one in every run. Foot slide under contact stays at 3.0-3.7 mm (3.0-3.6 with the current post-process), and pose error is unchanged.

Suggested fix: keep the raw vertical root motion in `correct_static_translation`, or re-anchor y per stance to one ground height. The raw height itself still varies 7-27 cm across these walks, so a per-stance ground would do more. Related: #9.
```

**PoseInversion autograd FK on per-frame shapes fails in py-soma-x 0.3.3**, in two ways:
- Its own chunking (`batch_size=16`) slices the bind cache but not the skinning layer: `ValueError: Incompatible batches: rotations=16, bind=300` (`batched_skinning.py:504`, from `_fit_autograd_public_layer`).
- An identity prepared with gradients on fails the second Adam step: "Trying to backward through the graph a second time".

`join_fingers.py` now prepares each 16-frame chunk's identity itself, under `torch.no_grad()`, whenever the fit options name `autograd_iters`. Against SOMA's own chunking on the default fit (clip 2338, 32 frames), that changes rotations by at most 0.0067 (matrix element), translation by 0.03 mm and per-vertex error by 0.27 mm.

Mesh fit error on clip 2338's first 16 frames, mean (median), mm:

| Fit | Error | Time |
|---|---|---|
| Default | 8.71 (5.74) | 4.1 s |
| Autograd 10 steps, lr 5e-3 (the documented example) | 10.61 (7.83) | 5.4 s |
| Autograd 10, lr 1e-3 | 8.84 (6.02) | 5.3 s |
| Autograd 50, lr 5e-3 | 8.63 (5.57) | 7.6 s |
| Autograd 50, lr 1e-3 | 8.53 (5.52) | 7.2 s |
| Autograd 200, lr 5e-3 | 8.11 (4.99) | 16.9 s |
| Autograd 200, lr 1e-3 | 8.11 (4.97) | 16.0 s |

So the documented 10 steps make the fit worse, and 200 improve it. The full-clip test (`tmp/join_autograd.ps1`, CPU, 4 threads) ran 200 steps at lr 1e-3, plain and with `autograd_leaf_weight {"hands": 3}`, against a per-chunk baseline with 0 steps. Scores are left hand then right, for SAM in SOMA (the conversion alone) and for the join:

| Clip | Fit | Mesh error, mm | Time | Conversion: shape, mm / bend, deg / shown | Join: shape / bend / shown |
|---|---|---|---|---|---|
| 2338 | default (`mocap.js`) | 9.7 | | 7.9, 7.3 / 8.5, 7.5 / 86%, 85% | 8.0, 7.8 / 8.2, 7.4 / 86%, 85% |
| 2338 | per-chunk, 0 steps | 9.7 | 150 s | same to 0.01 | same |
| 2338 | 200 steps | 9.0 | 436 s | 7.8, 7.2 / 8.5, 7.8 / 86%, 85% | 7.9, 7.8 / 8.2, 7.7 / 86%, 85% |
| 2338 | 200 steps, hands ×3 | 9.0 | 551 s | 7.9, 7.2 / 8.8, 7.4 / 84%, 83% | 8.0, 7.6 / 8.5, 7.3 / 84%, 83% |
| 20728 | default | 6.9 | | 8.7, 8.7 / 11.1, 10.0 / 85%, 78% | 9.1, 8.8 / 10.9, 10.0 / 85%, 78% |
| 20728 | per-chunk, 0 steps | 6.9 | 224 s | same | same |
| 20728 | 200 steps | 6.7 | 556 s | 8.7, 8.6 / 10.6, 10.2 / 84%, 78% | 9.0, 8.8 / 10.4, 10.1 / 84%, 78% |
| 20728 | 200 steps, hands ×3 | 6.7 | 451 s | 8.7, 8.6 / 10.5, 10.4 / 82%, 77% | 9.0, 8.8 / 10.3, 10.4 / 82%, 77% |

Not kept. The mesh fits better (9.7 to 9.0 mm, 6.9 to 6.7), but no more of the finger movement shows, and weighting the hands lowers it by 1-3 points. Bend error moves ±0.5° either way. With this, every documented PoseInversion mode is tested: default, no refinement (`lie_iters` 0), and autograd at 10 and 200 steps with and without hand weight. The 11-point loss from SAM 3D Body alone (97, 96%) to the conversion (86, 85%) isn't a fitting error. A tighter fit doesn't bring it back, so it more likely comes from SOMA's finger joints sitting differently in the hand mesh than MHR's. That's unmeasured.

The SOMA failures above could go to SOMA-X as an issue (autograd FK with per-frame identities and `batch_size`); not drafted or posted.

**Lens.** Panoptic HD camera 00_07's calibrated focal length is 1395.7/1392.3 px, with strong barrel distortion (k1 -0.286, k2 0.182, k3 -0.048). GEM-X's motion step, given no intrinsics, assumes the image diagonal, 2203 px (`body_video.py:65`), and it doesn't undistort. So every Panoptic run so far had a focal length 58% too long and a distorted image. GEM-X's config takes `camera.intrinsics` (docs/DEMO.md, "Choose camera rotation handling").

**Moving camera.** GEM-X issue #24 (closed): its demo used to fall back silently to a static camera. In our version (20555be), `camera_motion.py` raises an error instead. The maintainer points to `--camera-mode vipe` on main. `bench/pan_camera.py` (new) makes two videos from each walk:
- the full frame undistorted with its calibrated intrinsics;
- a 1280×720 virtual camera at the same focal length, turning about its centre to follow the tracked person with a 0.35 s operator lag, plus a handheld wobble (pitch ±1.5°, roll ±1°, yaw jitter 0.3°). It is drawn from the source by an exact rotation homography with the lens model, with no black borders: frames are pulled in when the view would leave the source. The pan spans yaw -12.8 to 13.5° and pitch -6 to 7° on both walks.

A sliding crop wasn't used, because the background estimator takes the polar factor of K⁻¹HK, and a pure image shift comes out as only about half the turn. The true rotations are saved for GEM-X's `provided` mode. GEM-X then runs `static` with intrinsics on the undistorted video, and `background` with intrinsics on the pan (`weights/body_video_native77_static_hd0007.yaml`, `weights/body_video_native77_background_pan.yaml`; `tmp/gem_pancam.ps1`, scoring `tmp/score_pancam.ps1`).

**Results** (`truth_body.js`, GEM-X world; each run against the same measured joints):

| Walk, input | Pose, mm | Motion, mm | Accel | Hip path, mm | Hip travel, mm (real) | Foot slide, mm | Own floor range, mm: raw, exported, raw y kept |
|---|---|---|---|---|---|---|---|
| 4648, original (distorted, diagonal focal) | 26.2 | 79.2 | 7.20 | 70.8 | 2631 (2464) | 3.1 | 199, 302, 201 |
| 4648, undistorted, calibrated intrinsics | 28.5 | 72.0 | 7.57 | 62.4 | 2601 | 3.0 | 271, 299, 272 |
| 4648, turning camera, `background` | 26.9 | 78.6 | 7.46 | 71.7 | 2507 | 3.1 | 163, 288, 165 |
| 13858, original | 37.1 | 83.4 | 9.38 | 69.8 | 2617 (2498) | 3.3 | 94, 289, 95 |
| 13858, undistorted, calibrated | 38.5 | 73.8 | 9.01 | 62.2 | 2619 | 3.0 | 162, 287, 161 |
| 13858, turning camera, `background` | 36.4 | 85.2 | 11.07 | 77.5 | 2521 | 3.6 | 72, 259, 73 |

Measured floor range: 17 mm (4648), 31 mm (13858). Each GEM-X run took 302-357 s, with the CPU test running beside it.

- **Moving camera works, at a cost.** With the background rotation estimate on a turning, wobbling camera, every frame from 0 to 299 was accepted (no skipped samples), and its hip travel is the closest to the real one (2507 and 2521 mm, against real 2464 and 2498).
  - Against the original static run: within 1 mm on pose, within 2 mm on motion, and 1-8 mm on hip path. That comparison mixes lenses, though: the pan has the calibrated pinhole lens, the original the distorted image with the diagonal focal.
  - Against the static run with the same calibrated lens (like for like): motion is 6.6 and 11.4 mm worse, hip path 9.3 and 15.3 mm worse, accel 0.1 better and 2.1 worse; pose is 1.6 and 2.1 mm better.

  The control run splits the cost: GEM-X's `provided` mode on the same video with the saved true rotations (`weights/body_video_native77_provided_pan<id>.yaml`, `tmp/gem_provided.ps1`, 290 and 267 s).

  | Walk | Static, calibrated | Turning, true rotations | Turning, background estimate |
  |---|---|---|---|
  | 4648: motion / hip path / accel / pose | 72.0 / 62.4 / 7.57 / 28.5 | 72.1 / 65.1 / 7.34 / 26.9 | 78.6 / 71.7 / 7.46 / 26.9 |
  | 13858 | 73.8 / 62.2 / 9.01 / 38.5 | 81.5 / 73.9 / 10.91 / 36.4 | 85.2 / 77.5 / 11.07 / 36.4 |

  - The rotation estimate costs 6.5 and 3.7 mm on motion and 6.6 and 3.6 mm on hip path, against the true rotations. That is all a better estimator such as ViPE could win back.
  - The rest is the turning, narrower view itself: 0.1 and 7.7 mm on motion.

  So ViPE isn't needed to handle camera turns. Camera translation (walking with the phone) is still untested: the GEM-X maintainer says ViPE's translation isn't used by the model either.
- **Calibrated lens.** World motion and hip path improve by 7-10 mm, and the camera-space path improves a lot (motion 54 against 182 mm, 70 against 194). Pose gets 1.4-2.3 mm worse. The floor is unchanged after contact IK (299 and 287 mm). So the drift isn't caused by the wrong lens.
- **The drift comes from GEM-X's contact step in all six runs.** Exported floor ranges are 259-302 mm, against 72-271 without the step. The hip-height change from the step (post minus raw), first to last half-second: 4648 -14.2, -4.0, -16.7 cm; 13858 -23.4, -18.4, -20.9 cm (ranges 13.5-26.2 cm).
- **"Raw y kept"** (`bench/keep_raw_y.py`, a measurement of the issue's suggested fix, like `kimodo_feet.py`; not in `mocap.js`) takes `correct_static_translation`'s x and z, keeps the raw root height lowered once so the lowest joint sits at 0, then runs GEM-X's `correct_static_pose` unchanged. Its re-run of GEM-X's own post-process first matches the saved result (transl within 4e-6 m, body_pose within 0.003 rad).
  - The floor range falls back to the raw one in all six runs.
  - Foot slide stays at 3.0-3.7 mm and pose is unchanged.
  - Motion is 2-10 mm worse.
  - GEM-X's raw height still drifts 72-272 mm, so a fix needs one floor height per stance, not only the raw y.

**Focal length alone**, measured 2026-11-04 (`tmp/gem_undistdefault.ps1`, 289 and 272 s): the undistorted walks, like a phone's rectified video, with GEM-X's default focal against the calibrated one. Exported world motion, contact IK:

| Walk, focal | Pose | Motion | Accel | Hip path | Hip travel (real) | Camera-space motion / hip path |
|---|---|---|---|---|---|---|
| 4648, default 2203 px | 26.7 | 76.6 | 7.40 | 68.1 | 2619 (2464) | 133.1 / 105.5 |
| 4648, calibrated 1394 px | 28.5 | 72.0 | 7.57 | 62.4 | 2601 | 54.4 / 48.6 |
| 13858, default | 37.6 | 84.4 | 8.83 | 71.7 | 2663 (2498) | 141.8 / 116.1 |
| 13858, calibrated | 38.5 | 73.8 | 9.01 | 62.2 | 2619 | 69.7 / 53.1 |

The real focal length alone moves:
- world motion 4.6 and 10.6 mm closer, and hip path 5.7 and 9.5 mm closer;
- the camera-space path about twice as close;
- pose 1.8 and 0.9 mm worse, and accel 0.2 worse.

Undistortion alone, against the original with the default focal, leaves world motion level (76.6 against 79.2, 84.4 against 83.4) and improves the camera-space path (133 against 182, 142 against 194).

Built under the 2026-11-04 go (decision 3): `bench/lens.js` (`focalTag`, `lensFor`), and `mocap.js --focal35 <mm>`. It reads the 35 mm equivalent from `--focal35`, or else the video's own tag, and converts along the frame's diagonal (Panoptic's 27.38 mm gives its calibrated 1394 px). It gives GEM-X a per-take `gemx_config.json` with `camera.intrinsics`; GEM-X's own `load_body_video_config` makes the model paths absolute (checked: all five resolve). `lens.json` beside `gem.pt` stops a run that asks for a different lens than the existing `gem.pt` was made with; takes from before count as the default lens (checked on clip 2338's take, both ways). Tests: `node --test bench/lens.test.js` (3 pass). ffmpeg can only write the Apple key at file level, so the test covers that. Whether ffprobe shows the track-level key of a real iPhone file is unknown, and a clip without a tag says so and points at `--focal35`.

**Gaze ruler, built 2026-11-04** under "go on all", for any camera (iPhone, Android, webcam).
- `bench/gaze/index.html`, served by `bench/gaze_ruler.js` on 127.0.0.1 only:
  - the 9-point grid eye trackers calibrate with, twice, 2.5 s a dot;
  - three white full-screen flashes at the start and the end (on 250 ms, off 350 ms);
  - the dot schedule is saved to `in/`.
- The page records nothing. A first version recorded the webcam in the page, which an iPhone or Android phone can't do, so it was dropped.
- `bench/truth_gaze.py` decodes any video through ffmpeg to 30 fps (rotation applied). It finds both flash sets by a matched filter on the face's brightness, timing each to a fraction of a frame, and maps the page's clock to the video's. It then scores, per eye, the pupil's place in the eye and MediaPipe's eyeLook blendshapes against the dot's place:
  - correlation per frame and per dot, with the sign shown, since a mirrored video flips it;
  - accuracy in degrees after a linear fit, when distance and screen width are typed;
  - head turn, as a stillness check.

Checked on a synthetic recording (`tmp/gaze_test`): one Multiface frame held for a minute, brightened during the flashes, starting 2.0 s before the page's clock. The scorer found the flashes at 1.98 s and 55.78 s (true 2.0 and 55.80, within half a frame), with a clock ratio of 1.00000. On a clip with no flashes it stops and says so. The server's own checks:
- the page is served and its script parses (`node --check`);
- a schedule is saved;
- a bad name is refused;
- an existing file isn't overwritten.

Not yet measured on a real gaze take, and Live Link Face's CSV isn't read yet.

**Lens for a user's clip, searched 2026-11-04.** Panoptic 00_07's 1395.7 px on a 2203 px diagonal is a 27 mm equivalent (by diagonal, 43.27 mm full frame), about a phone's main camera. GEM-X's default, focal = diagonal, is 43 mm, so a phone clip also gets too long a focal length. Queries:
1. "iPhone video metadata focal length 35mm equivalent exiftool QuickTime camera lens": Apple's AVFoundation documents a track-level QuickTime key `com.apple.quicktime.camera.focal_length.35mm_equivalent`, a string such as "50.00mm", from iOS 26.0, beside a lens model tag. ExifTool reads it as the "VideoKeys" group from 13.13; user reports say older iPhone .mov files carry no lens data.
2. "estimate camera focal length from single image open source GeoCalib MoGe-2 field of view accuracy": [GeoCalib](https://github.com/cvg/GeoCalib) (ETH Zurich, ECCV 2024, Apache-2.0, pushed 2026-10-29) estimates focal length and gravity from one image, with uncertainty. MoGe-2 (arXiv 2507.02546) gets the field of view as a by-product of its point map.

Neither is wired in or measured here.

**Eyes and jaw in the body file, measured 2026-11-04.** In `out/take/pan_fingers2338_full/pan_fingers2338_full.bvh`, both eyes sit at -11.2° X and ±3.8° Y for the whole clip (range 0.3°), and the jaw within 0.6°. These are GEM-X's near-constant values (section 13: spread 0.01-0.08° on all four clips), not motion. A retargeter that maps eye bones would hold the character's eyes about 11° off and slightly turned in or out. The face CSV already carries `JawOpen` (follows Multiface at 0.96) and the eye-look curves.

Built under the 2026-11-04 go: `export_mocap.py` zeroes Jaw, LeftEye and RightEye in `body_pose` before posing. These joints have no children, and zero is the rest pose in SOMA's parent-relative convention. Test on clip 2338's take, exported to `out/take/pan_fingers2338_full/rest_test/`:
- the face channels are 0 (within 1e-6°), and every other channel is unchanged (largest change 0.000000);
- the BVH reads back within 0.001 mm.

The skeleton offsets differ from the 2026-11-02 file by up to 6 µm, from float rounding with `OMP_NUM_THREADS=4`: an export with default threads matches the old offsets exactly.

**Brows, searched 2026-11-04.** Query: "MediaPipe face blendshapes eyebrow weak improve brow raise from landmarks calibration open source". Found:
- [MeFaMo](https://github.com/JimWest/MeFaMo) (MIT, 506 stars, last push 2023-03-26), `blendshape_calculator.py`: the brow keys come from MediaPipe landmark distances in its pose-normalised face geometry, mapped through fixed hand-set ranges (`blendshape_config.py`):
  - brow 27/257 to the mean of 53, 52, 65 and 283, 282, 295 gives BrowDown and BrowOuterUp per side;
  - inner brow 9 to the upper nose gives BrowInnerUp.
- REFA (CVPRW 2024, supplemental): per-user calibration that takes a blendshape's most frequent value over 30 s as neutral, applied only to keys where that holds, such as brow raise.
- ExpressionAppBridge (github.com/Guerra24/ExpressionAppBridge): a startup calibration saved to JSON.
- ComfyUI's `SAM3DBody_FaceExpression` doc: MediaPipe's brow outputs run low (about 0.1-0.3) and it suggests a 2-3× gain.

Already measured (section 13): MediaPipe's brow points follow the real brow at 0.88-0.97, its brow blendshapes at 0.74-0.82.

Measured 2026-11-04 (`bench/brows_mf.js`, Multiface, the eight sequences, 428 frames, camera 400048). Each MediaPipe measure is correlated with the real mesh's, at full / 140 px / 70 px faces:

| Brow | Our points (brow 105/334, inner 107/336, to the eye-corner midpoint, over the corner distance) | MeFaMo's distances (2D, over the corner distance) | MediaPipe blendshape |
|---|---|---|---|
| Right height | 0.97 / 0.96 / 0.94 | 0.90 / 0.90 / 0.91 | browOuterUpRight 0.81 / 0.82 / 0.82; browDownRight -0.67 / -0.66 / -0.68 |
| Left height | 0.92 / 0.90 / 0.87 | 0.82 / 0.81 / 0.83 | browOuterUpLeft 0.74 / 0.73 / 0.73; browDownLeft -0.83 |
| Right inner height | 0.92 | 0.91-0.92 (9 to 6) | browInnerUp 0.80 |
| Left inner height | 0.93 | 0.86-0.87 | browInnerUp 0.74 |

Eyelid leak, as correlation with the real eye opening:
- the real brow: 0.35 right, 0.10 left (these posed sequences move brows and lids together);
- our points: 0.43-0.49 right, 0.21-0.30 left;
- MeFaMo's: 0.28-0.29 right, about 0 left.

So MeFaMo's measure, taken from the upper lid crease (27/257), drops the lids but follows the brow less well. Our points follow best at every size, with a small lid leak. Caveats: one person, posed, a front camera, in 2D; head turns and the right size are unmeasured.

**Open decisions as reported on 2026-11-04** (recs, not approved):
1. Floor plant (NOT STANDARD).
2. Post the drift issue (the user runs it; the permission check blocks me).
3. Lens from the phone's metadata.
4. Jaw and eye joints at rest in the body file.
5. Brows from MediaPipe's points (NOT STANDARD).
6. Test clip, now with one handheld take.
7. Gaze ruler.

**Body fallback with tracking, run 2026-11-04 under "go 3".** SAM 3.1's checkpoint was downloaded (1,745,546,848 bytes) into ComfyUI's `models/checkpoints`. `run_full.js` has a sixth argument, `track 1`, wired as ComfyUI's template: SAM 3.1 video tracking with the prompt "person", up to 4 objects, RT-DETR at up to 100 boxes, track 0 exported. `subway_guitar_busker.mp4` (1280×720, 24 fps, 121 frames), `node run_full.js subway_guitar_busker.mp4 8 1 1 0 1`: 228 s in all (tracking 37 s, predict 156 s), 5,763 MiB peak.
- The root jumps per frame of the exported raw BVH: before (one box, no tracking) a median of 2.6 cm, but 320, 315 and 262 cm at frames 3, 2 and 39, the person switches; with tracking a median of 2.5 cm and at most 5.0 cm, so no switch in 121 frames.
- By eye on 8 overlay frames (`out/pancam/sheet_subway_guitar_busker-b8*.jpg`): the one-box run's second sample has the skeleton on a passer-by and none on the guitarist. With tracking, the guitarist has the main skeleton in all eight, and the passers-by get their own tracks.

So tracking fixes the switch. Not yet in `mocap.js`:
- track 0 is the first person SAM 3.1 detects, which needn't be GEM-X's person (its largest cumulative box), so the finger join could take another person's hands;
- `mocap.js` runs SAM 3D Body in pieces for 4K, and track numbers can differ between pieces.

**Floor plant, built and measured 2026-11-04 under "go floor plant"** (`bench/floor_plant.py`, CPU, a few seconds a clip). GEM-X's `correct_static_translation`, then a root-height offset, then GEM-X's `correct_static_pose` unchanged.
- The offset: where GEM-X's heel (Foot) or toe (ToeBase) contact is above 0.8, that joint belongs at its standing height (rest pose, above the rest pose's lowest joint: ankle 6.4 cm, toe base 1.6 cm). The contact-weighted mean of that gap is fitted with a Whittaker-Henderson smoother (weights = contact, second-difference penalty 10) and added to the root height.
- Six runs: both walks, each with the original lens, the calibrated lens and the turning camera. Before is GEM-X with contact IK, as exported.

| Run | Floor range, mm (real 17 / 31) | Pose, mm | Accel | Foot slide, mm (real 4.6 / 3.4) | Bob where GEM-X is firm, mm | Upright motion, mm | Hip height RMS, cm |
|---|---|---|---|---|---|---|---|
| 4648 original | 302 → 17 | 26.2 → 26.1 | 7.20 → 7.27 | 3.1 → 3.4 | 3.32 → 3.57 | 128.1 → 96.0 | 9.5 → 2.3 |
| 4648 calibrated | 299 → 14 | 28.5 → 28.5 | 7.57 → 7.63 | 3.0 → 3.1 | 3.12 → 3.51 | 115.2 → 88.2 | 8.9 → 2.1 |
| 4648 turning camera | 288 → 16 | 26.9 → 26.8 | 7.46 → 7.55 | 3.1 → 3.4 | 2.75 → 3.45 | 125.8 → 96.9 | 9.2 → 2.5 |
| 13858 original | 289 → 38 | 37.1 → 37.2 | 9.38 → 9.45 | 3.3 → 3.7 | 3.04 → 10.19 | 120.0 → 105.3 | 8.9 → 4.8 |
| 13858 calibrated | 287 → 27 | 38.5 → 38.4 | 9.01 → 9.06 | 3.0 → 3.2 | 2.72 → 6.08 | 110.5 → 94.9 | 9.1 → 3.7 |
| 13858 turning camera | 259 → 29 | 36.4 → 36.3 | 11.07 → 11.19 | 3.6 → 3.9 | 3.49 → 7.04 | 124.4 → 109.4 | 9.0 → 4.1 |

The new scores (scripts in `bench/`):
- **Upright motion** (`truth_upright.js`): the whole-clip error with GEM-X's up kept on the measured up, one turn about the vertical, one shift and one scale. `truth_body.js`'s motion uses a full similarity, which tilted the drifting clip and showed the plant 9-12 mm worse; with up kept up it is 15-32 mm better.
- **Hip height RMS** (`truth_hip_height.js`): the hip's height above its own floor over time, no line-up, GEM-X scaled by leg length.
- **Bob** (`truth_planted.js`): a planted ankle's up-and-down inside a measured stance, on frames where GEM-X calls that foot firm. The measured data's own bob is 3.1 and 3.9 mm (`tmp/truth_bob.js`).

**Kept against its approved test? No.** The test was: "keep only if the floor nears the real 17-31 mm with pose, foot slide and jerk no worse". Floor and pose pass, but foot slide is 0.1-0.4 mm worse and acceleration error 0.6-1.2% worse (corrected 2026-11-05; first written as "jerk passes"). Planted feet also bob more: by 0.3-0.7 mm on 4648, and by 3.4-7.2 mm on 13858.

Why, on 13858 (`tmp/floor_levels.py`): in GEM-X's own world, its two firmly planted feet in double support sit 8-14 cm apart in height (left 18-26 cm, right 10-12 cm, same frames). Its foot pitch also swings: heel above toe by 1.3-7.7 cm, against 4.8 cm in the rest pose. GEM-X's world followed its feet up and down; on one flat floor, one root offset can't put both down.

Tried and dropped:
- a straight blend then Gaussian smoothing (σ 3), which ramped the offset inside stances;
- one level per foot per stance (bob 7.1 against 6.4 on 4648);
- GEM-X's leg IK aimed at the floor (a copy of `correct_static_pose` with firm targets at standing height, equal to GEM-X's to 0.0 with the change off): slide better on 4648, worse on 13858 (3.7 to 4.4), bob unchanged.

So the plant isn't in `mocap.js`, pending the user's call. A full-body solve (root and legs together, as UnderPressure's cleanup optimises) would be the way to plant both feet in double support.

**GEM-X's "up" against Panoptic's calibration** (`bench/gem_gravity.py`): GEM-X's world-to-camera rotation (root camera orientation times world orientation transposed) puts world up 9.9-17.7° from the calibrated camera's up on average, 3-24° per frame; it changes with the lens (12.0 and 17.7° calibrated). Its torso lean in its own world is close to the measured one (11.1 against 8.4°, 28.8 against 28.2°), so the error lies mostly in where GEM-X places the camera, not in its world.

**Brows, built and measured 2026-11-04 under "go brows"; not kept, and the "weak brows" finding corrected.** `bench/face_brows.py`:
- the brow and inner-brow height from MediaPipe's 3D points, with the head turn undone by its facial transformation matrix;
- mapped by rank (quantile mapping) onto MediaPipe's own values for each key in the clip, so the size stays MediaPipe's;
- MediaPipe's own values kept when the two disagree under 0.3.

Test on Multiface (`tmp/brows_multiface.py`; `bench/mp_face_frames.py` now also saves the 3D points and the matrix, `out/mfface3d_*`; scored by `bench/brows_mf.js`, all eight sequences, 428 frames):
- **Two-sided**, against the brow's full height as section 13 scored it: the new keys follow no better than MediaPipe's (right up 0.81 against 0.81, left 0.71-0.73 against 0.73-0.74).
- **One-sided**, as ARKit defines its keys (browOuterUp is zero at rest and for lowered brows, browDown the reverse): an Up key is scored against how far the real brow rises above its rest height (its median over the neutral sequence), a Down key against how far it drops below.

| Full / 140 px / 70 px face | MediaPipe's keys | New keys | Our points (linear) |
|---|---|---|---|
| Right up | 0.86 / 0.88 / 0.88 | 0.86 / 0.87 / 0.87 | 0.94 / 0.93 / 0.93 |
| Right down | 0.97 / 0.97 / 0.97 | 0.97 / 0.97 / 0.97 | 0.46 / 0.47 / 0.42 |
| Left up | 0.91 / 0.91 / 0.90 | 0.91 / 0.90 / 0.89 | 0.88 / 0.86 / 0.86 |
| Left down | 0.98 / 0.98 / 0.98 | 0.96 / 0.95 / 0.94 | 0.68 / 0.66 / 0.62 |

So section 13's "brows are the weak part" (blendshapes 0.73-0.82 against points 0.88-0.97) came from scoring one-sided keys against a two-sided measure. MediaPipe's brow keys follow well; the rebuilt keys do no better and aren't in `export_mocap.py`. What stays open is the keys' size against an ARKit ruler (ComfyUI's SAM 3D Body face node doc says MediaPipe's brows run low, 0.1-0.3). Head turns were not tested, since Multiface's camera faces the person.

**Re-attacked 2026-11-04 ("rethink them all adeverserily"), designs changed, not built (NOT STANDARD):**
- Floor plant: a per-stance offset (the planted heel or toe's rest height minus its height), blended across swings and added to GEM-X's own root height, instead of replacing the root height. That keeps real bounce and jumps. Only stances with firm contact (heel and toe above 0.8) set an offset, so a half-planted raised heel (0.62 on 13858) isn't pulled down. Off switch for stairs and ramps.
- Brows: our points' brow height, fitted per clip by least squares onto MediaPipe's own brow blendshapes, so the timing follows the better measure while the size stays MediaPipe's. This replaces a per-clip neutral, which fails when someone holds one expression. MediaPipe's 3D points with its head transform undone, so a head turn doesn't read as a brow move.

**Body fallback, checked 2026-11-04.** ComfyUI's own SAM 3D Body template (`comfyui_workflow_templates_json/templates/utility_sam3d_body.json`, 0.11.97) tracks with `SAM3_VideoTrack`:
- SAM 3.1, `sam3.1_multiplex_fp16.safetensors` through `CheckpointLoaderSimple`, with the prompt "person" (widgets 0.5, 4, 1);
- RT-DETR at up to 100 boxes;
- both into `SAM3DBody_Predict`'s `track_data` and `bboxes`.

Its note: "For multiple people in same clip SAM3 is practically required". `run_full.js` caps RT-DETR at one box and doesn't track. The checkpoint isn't on disk: Comfy-Org/sam3.1 on Hugging Face, `checkpoints/sam3.1_multiplex_fp16.safetensors`, 1.75 GB, SAM License, not gated. It waits for the user's OK to download.

**Floor fix, existing methods, searched 2026-11-04.** Queries:
1. "fix vertical drift ground world-grounded human motion from video foot contact post-processing": WHAM (arXiv 2312.07531, a learned trajectory refiner inside WHAM, not standalone), HTD-Refine (arXiv 2605.26879), Zou & Huang WACV 2020 (contact detector plus optimisation), ProxyCap.
2. "best open source foot contact cleanup mocap floor plant tool 2026": Foot Flow (a Blender add-on, May 2026, its author still testing, no replies), UnderPressure, Mocap Bone Lock (paid Blender add-on).
3. "GVHMR WHAM TRAM foot sliding floor penetration ground plane refinement code": only WHAM.

Read:
- **[UnderPressure](https://github.com/InterDigitalInc/UnderPressure)** (InterDigital, SCA 2022; last commit 2023-05-14; Limited Software Evaluation License: research only, no commercial use, no modification). `footskate.py`'s `Cleaner` is a two-sided plant: for each contact range the foot's contact points (a foot-height offset below the ankle and toe joints) get a target at the contact's mid-frame x, y and at ground height z = 0. Adam then optimises all joint rotations and the root path together, against:
  - the contact-position loss, eased in and out at the range ends;
  - keeping the root velocity close to the original (weight 1e2);
  - its own vGRF network's forces staying the same;
  - a final Gaussian smoothing (size 15, std 3).

  So it moves the root height as well as the legs. Its contacts come from its own pretrained vGRF network on its own 23-joint skeleton. The method is published, so it can be written in our code on SOMA's differentiable FK with GEM-X's contacts.
- **[HTD-Refine](https://zju3dv.github.io/htd-refine)** (Wei, Shen, ..., Zhou; CVPR 2026; code at github.com/ant-research/HTD-Refine): it refines TRAM, GVHMR and Human3R with predicted velocities and accelerations, has no ground or contact term, and its foot skating gets worse on GVHMR/EMDB (4.0 to 5.7). Not a floor fix.

### 2026-11-03, the floor drifts 29-30 cm in GEM-X's own world, no card used

Correction of the floor block below: its "not a slow drift or a tilt" was wrong. It rested on 4648's left stance from frame 124, which GEM-X itself marks as not planted (heel contact 0.03, toe 0.06: the real heel is up there), and on heights taken after `truth_body.js`'s one alignment per clip, which rotates and scales a drifting floor nearly flat.

New score in `truth_body.js`, "own floor": the spread and range of planted ankle heights in the result's own world frame, with no alignment, over the stances where the real ankle sits at its usual planted height (within 3 cm of the median), so raised heels don't count. `STANCES=1 CONTACTS=<json>` now also prints GEM-X's own heel and toe contact per stance, knee bend, hip-to-ankle reach and the own-frame height.

| Walk | Real | GEM-X raw world | GEM-X with contact IK (exported) | Kimodo after contact IK |
|---|---|---|---|---|
| 4648, spread, range | 4.8, 17 mm | 61.4, 199 mm | 92.3, 302 mm | 87.9, 277 mm |
| 13858, spread, range | 9.4, 31 mm | 24.5, 94 mm | 81.7, 289 mm | 77.1, 263 mm |

So in the exported motion the planted feet go down about 30 cm over each 10 s walk: on 4648 the left foot plants at 35.8 cm at frame 19 and 8.2 cm at frame 187. A character on a flat floor would float at the start and sink later. The cause is mostly GEM-X's own contact step: `correct_static_translation` (`gem/motion/postprocess/contact.py:157-166`) rebuilds the root path as the running sum of root motion minus the planted joints' motion in all three axes, smooths only x and z, then lowers the whole clip once so its lowest point is at 0. Any vertical slip of a "planted" joint adds up. The root after the step minus before, every 30 frames: 4648 120.2, 108.9, 104.2, 103.5, 106.0, 100.1, 99.1, 100.9, 101.3, 102.5 cm; 13858 116.5, 107.7, 102.1, 102.5, 99.2, 99.1, 97.5, 97.0, 95.5, 92.1 cm (the constant part is the one lowering). GEM-X raw drifts too, 9-20 cm.

The aligned stance heights mislead in a second way: the alignment's scale shrinks GEM-X's legs to a hip-to-ankle reach of 75-76 cm on 13858 (real 80-86), which reads as a 6 cm float on every stance. Knee bend on level stances matches the truth within a few degrees (e.g. 4648: 175/175, 174/178), so the legs are not too bent there. On raised-heel stances GEM-X bends the knee more (4648 frame 124: 174 real, 153 GEM-X).

GEM-X upstream (NVlabs/GEM-X, fetched 2026-11-03): two commits after ours (20555be, 2026-10-21): `4aef145` adds `--camera-mode vipe` (ViPE camera rotations and intrinsics for moving cameras, `docs/VIPE_CAMERA.md`), `9c6e8bb` adds benchmark evaluation. `contact.py` is unchanged. Issue #9 "The heel lifts off the ground" is open; a maintainer suggests moving the mesh's lowest point to y=0, which is one shift for the whole clip and can't fix a drift. No issue reports the vertical drift (the titles of all 28 issues, open and closed, read; #9 read in full).

`video2mocap` (`tmp/video2mocap`, 484bfc5, Apache-2.0) has ground placement (one median shift) and a foot lock whose anchors snap to the ground with two-bone IK only, so it can't lower a foot that floats more than the leg's slack.

GEM-X's post-process is `correct_static_translation` then `correct_static_pose` (`gem/motion/postprocess/api.py:98-99`), both public functions, so a root-height step fits between them without changing GEM-X. Our camera mode is `static` (`weights/body_video_native77_static.yaml`); GEM-X's default `background` mode (SIFT/homography camera rotation, `gem/inference/body_video.py:144`) is already in our version for moving cameras. ViPE (github.com/nv-tlabs/vipe, Apache-2.0 except its Unik3D part, BY-NC-SA 4.0) doesn't state Windows support; its issue #60 points to a community fork, github.com/crazyzyz/VIPE-windows; VRAM is unstated.

SOMA PoseInversion's one documented mode not yet tried on the fingers: autograd FK refinement after the default solve (`autograd_iters`, with `autograd_leaf_weight` for the hands only; `pose_inversion.py:1369-1440`). On clip 2338 the conversion alone ("SAM in SOMA") already has a lower bend error than SAM 3D Body alone (8.5, 7.5° against 9.5, 8.5°) while showing less movement (86, 85% against 97, 96%).

Drafted issue for NVlabs/GEM-X, not posted (superseded by the 2026-11-04 text above): "Contact post-process sums vertical joint motion into the root: planted feet drift about 30 cm over 10 s. `correct_static_translation` (gem/motion/postprocess/contact.py:157-166) rebuilds the root path as the running sum of root displacement minus contact-weighted joint displacement in all three axes, smooths x and z only, then subtracts one ground_y for the whole clip, so vertical slips of joints flagged static add up in the root height. CMU Panoptic 171204_pose1, HD camera 00_07, 1080p, frames 4648-4947 and 13858-14157, static camera, body_video_native77_static.yaml, --postprocess, commit 20555be (contact.py unchanged on main 4aef145): the root height after the step minus before drops 20 cm and 24 cm over 10 s; planted ankle heights in the world output span 302 and 289 mm over stances where the measured ankle is at its planted height (measured data 17 and 31 mm; without post-processing 199 and 94 mm). A per-stance ground height for y, or keeping the raw y, would avoid the accumulation."

### 2026-11-03, wrist orientation, the runner's card test and the finger resolution limit

**Wrist** (`bench/truth_wrist.js`, new): the hand's rotation relative to the forearm (forearm frame from shoulder, elbow and wrist; hand frame from the wrist and the index, middle and pinky knuckles), against Panoptic's measured hands, median degrees, left then right. Elbows straighter than 155° are skipped. The other hand scores 31-120°, so the sides hold.

| Clip | GEM-X's wrist (join until now) | SAM 3D Body's wrist copied (`join_fingers.py ... sam`) | SAM 3D Body alone |
|---|---|---|---|
| 2338 | 43.4, 35.5 (roll 37.3, 26.4) | 21.1, 16.0 (roll 19.7, 14.2) | 11.0, 15.2 |
| 20728 | 42.7, 24.2 | 20.6, 11.8 | 11.3, 11.7 |
| 4648 (78-79 frames) | 15.7, 11.3 | 10.4, 15.0 | 12.4, 16.1 |
| 13858 | 18.2, 44.9 | 16.9, 26.2 | 17.3, 19.2 |

So the join's hands were turned 24-45° wrong close up, mostly in roll, and copying SAM 3D Body's wrist rotation halves that with the finger scores unchanged. The rest was roll, because the forearm's twist still came from GEM-X. Mode `arm` gives GEM-X's hand SAM's orientation relative to the arm plane (hand world W' = F_gem F_sam^T W_sam, wrist = W_forearm^T W', with W = G O^T, which is what SOMA's pose rotations chain to), keeping GEM-X's elbow:

| Clip | `gemx` | `sam` | `arm` | SAM 3D Body alone |
|---|---|---|---|---|
| 2338 | 43.4, 35.5 | 21.1, 16.0 | 9.4, 14.0 | 11.0, 15.2 |
| 20728 | 42.7, 24.2 | 20.6, 11.8 | 14.1, 13.6 | 11.3, 11.7 |
| 4648 (78-79 frames) | 15.7, 11.3 | 10.4, 15.0 | 10.0, 20.7 | 12.4, 16.1 |
| 13858 | 18.2, 44.9 | 16.9, 26.2 | 20.0, 13.9 | 17.3, 19.2 |
| Mean, worst | 29.5, 44.9 | 17.3, 26.2 | 14.5, 20.7 | 14.3, 19.2 |

`mocap.js` uses `arm`. Finger scores are the same in all three modes.

**Runner card test:** `mocap.js` on a 60 fps copy of clip 2338 (GEM-X's result reused, since GEM-X converts to 30 fps itself): 30 fps copy, SAM 3D Body in two pieces (258 and 42 frames, 4,892 MiB peak, ComfyUI 12.6 GB RAM peak), joined to 300 frames, BVH and FBX read back within 0.004 mm. Joined fingers 8.0, 7.8 mm, bend 8.3°, 7.6°, against 8.0, 7.8 mm and 8.2°, 7.4° before.

**Finger resolution limit** (SAM 3D Body alone on clip 2338, left then right):

| Size | Hands | Shape, mm | Bend error, deg | Follows | Shown |
|---|---|---|---|---|---|
| Full | 110-122 px | 7.3, 7.7 | 9.5, 8.5 | 0.95, 0.95 | 97%, 96% |
| Half | 55-61 px | 8.0, 8.6 | 9.5, 9.0 | 0.95, 0.95 | 98%, 97% |
| Quarter | 28-30 px | 12.7, 12.4 | 13.2, 11.8 | 0.89, 0.90 | 50%, 52% |

Fingers break between about 30 and 55 px. A full-body 1080p shot puts hands near 50 px, at the edge; 4K puts them near 100 px.

**Floor, per planted step** (corrected in the block above: the floor does drift) (`STANCES=1 node truth_body.js ...`, GEM-X with contact IK, after the clip's one alignment; Panoptic's y points down, so a negative difference means GEM-X's ankle is higher): walk 4648, by time, -1.0, -3.8, -6.3, -6.0, +0.7, -7.8, -0.2, +1.2, +1.1, +0.1 cm; walk 13858, +1.7, -6.8, -6.4, -5.6, -13.5, -8.1, -6.4, -11.7, -5.9, -5.5, -4.3 cm. Not a slow drift or a tilt, since the left and right feet differ at the same spot (4648 around x -100: -7.8 and +0.7). Planted feet float 4-13 cm in parts of both walks, worst where the real heel is up (real ankle 15-19 cm high, GEM-X's 27-30). So GEM-X's legs are too bent or short on those steps. Kimodo can't fix it: it only lifts a planted foot that sinks. A fix needs a two-sided plant (a planted foot pulled down to the floor as well as up, with leg IK).

### 2026-11-03, Kimodo foot cleanup and PoseInversion refinement, measured, no card used

Kimodo MotionCorrection, upstream (github.com/nv-tlabs/kimodo, commit e1c219c, Apache-2.0), built for Python 3.12 with Visual Studio 2026 in 76 s into `tmp/kimodo-mc` (`pip install --no-deps --no-build-isolation --target`, `CMAKE_GENERATOR="Visual Studio 18 2026"`). `bench/kimodo_feet.py` runs it on the exported BVH (GEM-X's contact-IK body) with GEM-X's own foot contacts. Scored by `truth_body.js`, before then after:

| Walk | Pose, mm | Motion, mm | Accel error | Hip path, mm | Foot slide, mm (real) | Floor spread, mm (real) |
|---|---|---|---|---|---|---|
| 4648 | 26.2 → 28.3 | 79.2 → 81.9 | 7.20 → 7.27 | 70.8 → 70.7 | 3.1 → 1.3 (4.6) | 50.9 → 47.8 (24.2) |
| 13858 | 37.1 → 38.3 | 83.4 → 84.5 | 9.38 → 9.30 | 69.8 → 70.1 | 3.3 → 0.8 (3.4) | 60.1 → 58.6 (30.2) |

Not kept. The floor spread drops only 3-6% and stays about twice the real one, pose and motion get 1-3 mm worse, and foot slide falls below the measured data's own (which includes the heel rolling). Why the floor barely moves: Kimodo lifts a planted foot that sinks below its rest height, but leaves one that floats above it (`Utility.cpp:186`, `std::max(framePt.GetY(), minHeight)`). The "before" scores repeat section 12's exactly, so the BVH round trip is clean.

PoseInversion with `lie_iters` 0 against the default 3 (SOMA-X PR #21), default finger smoothing, left hand then right:

| Clip | Steps | Shape, mm | Bend error, deg | Follows | Shown |
|---|---|---|---|---|---|
| 2338 | 3 (default) | 8.0, 7.8 | 8.2, 7.4 | 0.95, 0.95 | 86%, 85% |
| 2338 | 0 | 8.1, 8.1 | 8.7, 8.1 | 0.95, 0.95 | 89%, 91% |
| 20728 | 3 (default) | 9.1, 8.8 | 10.9, 10.0 | 0.94, 0.90 | 85%, 78% |
| 20728 | 0 | 9.4, 8.9 | 10.8, 10.2 | 0.92, 0.91 | 87%, 84% |

Not kept: no refinement shows 2-6 points more of the movement but costs a little shape and bend accuracy, and the mesh fits worse (11.1 and 7.8 mm). The default stays.

30 fps step: the Panoptic clips were already 29.97 fps (30000/1001); their 300 frames matched only because 10 s rounds to 300 either way. A 60 fps copy of clip 2338 (601 frames) and the 29.97 original both come out of GEM-X's converter at 300 frames.

### 2026-11-03, facts checked for the five open decisions, no card used

- py-soma-x's `rotvec_to_matrix` is still wrong on SOMA-X main (read today, after 0.3.4 on 2026-10-09 and 0.3.5 on 2026-11-02). Re-measured against SciPy: 90° about Z gives determinant 0.759 and a nearest rotation of 47° (the research file said 51°, now corrected); (0.3, -0.2, 0.5) gives determinant 1.146; a 5e-7 rad turn gives determinant 2.0, so the small-angle branch is wrong too. Nothing in SOMA or GEM-X calls it. The repo's issues and PRs don't mention it (GitHub searches `rotvec`, and `rodrigues OR rotation OR transforms`).
- Open SOMA-X PR #21: PoseInversion's Lie-GN refinement drifts off true rotations, worst at fingertips. `join_fingers.py` runs the default, `lie_iters=3`. Whether this costs finger movement is untested.
- Frame rates: GEM-X resamples every clip to 30 fps (`gem/inference/video.py:142`). The SAM 3D Body step reads the source frames (`run_full.js:26`), and the join stops when the frame counts differ (`join_fingers.py:107`). So a 60 fps or 29.97 fps phone clip fails `mocap.js` as it stands.
- ComfyUI's `LoadVideo` decodes the whole clip into memory as one IMAGE tensor. At 32-bit floats (ComfyUI's IMAGE type, inferred, not measured here) that is about 7.5 GB for 10 s of 1080p and about 30 GB for 10 s of 4K.
- QuickMagic's own recording guide, from our notes (`live-and-apps.md:265`): 720p or higher, a flat camera angle because elevated views make motion lean, one continuous shot, steady subject size, small hands lose accuracy.
- Retargeting: JustStage's standards give it to its importer, `import.characterise` with a per-source profile (`E:\Dev\3D\just-stage\docs\standards\README.md:94`, `skeleton-and-face.md` §1.5). JustDirect's test bodies use MPFB2's UE-named `rig.game_engine.json` (`E:\Dev\Web\test-just-direct\mhbody.py:19`). SOMA's `LeftLeg` is the thigh and `LeftShin` the shin, while HumanIK's `LeftLeg` is the shin, so a name-guessing retargeter would put thighs on shins.
- Kimodo MotionCorrection is on disk as source in RGB MoCap's clone (`rgbmocap/third_party/KimodoMotionCorrection`, upstream commit e1c219c, patched for SMPL-X). Its prebuilt module is for Python 3.10, and GEM-X's venv is 3.12.9. Visual Studio Community 2026 is installed on E:; its C++ workload is unchecked.
- C: leftovers: `%LOCALAPPDATA%\NVIDIA\warp` holds 3.17 MB, 18 SOMA kernel files written 2026-10-31 (card) and 2026-11-02 (CPU), two separate times a run missed `WARP_CACHE_PATH`. No other cache of ours on C: since 2026-10-31. The user-level variables already point `UV_CACHE_DIR` at E:.

### 2026-11-02, export to BVH, FBX and face CSV, `bench/export_mocap.py` and `bench/mocap.js`, research section 14

Clip 2338. The BVH (77 SOMA joints, cm, Y up) read back matches the posed skeleton to 0.001 mm; the BVH and the FBX, imported back into Blender 5.3, match to 0.002 mm. The FBX keys start at time 0, like the video. Face curves go out in Live Link Face's CSV layout. Drawn on the video, the body sits on the person and the hand shapes match by eye.

Finger smoothing (SOMA's RTS smoother, hand gains, fingers only), all four clips: default cuts finger shake to about a quarter (close 0.85-1.06 to 0.23-0.29 deg/frame², far 2.26-2.88 to 0.63-0.68) with no loss on shape, bend, following or movement shown; strong cuts it to about a twelfth but costs up to 0.7 mm of shape close up and up to 8 points of movement shown. `mocap.js` uses default. Table in research section 14.

Bug found on the way: py-soma-x 0.3.3's `rotvec_to_matrix` is wrong for any real angle, and the join used it, so every body joint in the joined pose was off (feet up to 860 mm). Fixed with SciPy. The finger scores stand (clip 2338: 8.0 and 7.4 mm against 8.0 and 7.5), because they align each hand first.

### 2026-11-02, face and eyes, `bench/truth_face_mf.js` against Meta's Multiface

GEM-X's jaw and eye joints barely move (eyes 0.01-0.08° spread). Panoptic `171204_pose1` has no usable face movement, so it can't rank face methods. On Multiface (one subject, eight posed sequences, front camera 400048, 428 of 440 frames found), MediaPipe Face Landmarker's points follow mouth opening at 0.99 and eye opening at 0.95-0.98, the same at full size, 140 px and 70 px faces; `jawOpen` 0.96, `eyeBlink` -0.91 to -0.95, `mouthSmile` 0.87; brows weaker, points 0.88-0.97 showing 65-72% of the movement, brow blendshapes 0.73-0.82. Gaze unmeasured: the mesh has no eyeballs. Full table in research section 13.

### 2026-11-02, SAM 3D Body fingers joined onto GEM-X, `bench/join_fingers.py`

Same four clips. GEM-X body + SAM 3D Body fingers against SAM 3D Body alone, close clips 2338 and 20728: shape 7.5-9.1 mm against 7.3-8.6, bend error 7.5-11.2° against 8.5-11.7, follows 0.90-0.95 against 0.91-0.95, shown 78-86% against 86-101%. Far walks: about level with SAM 3D Body alone. GEM-X's own fingers were 13.4-20.2 mm and 49-66% shown close up. A shape per frame is needed: one average shape lost 4° and 0.24 of following on walk 4648's left hand. Full table in research section 12.

### 2026-10-31, walking against CMU Panoptic, `bench/truth_body.js` and `bench/truth_hands.js`

Clips `pan_walk4648.mp4` and `pan_walk13858.mp4`, 300 frames, 1080p, camera 00_07, static. Full tables are in research section 12.

- Body: GEM-X with contact IK wins both clips on every score. Motion 79-83 mm against SAM 3D Body's 173-186 mm. Foot slide 3.1-3.3 mm against 20.0-26.6 mm, where the measured data's own wander is 3.4-4.6 mm. Raw GEM-X slides 23.9-25.4 mm, so contact IK is needed.
- Both standing clips have the legs out of frame. GEM-X loses clip 2338 on pose and ties 20728. On arms and shoulders alone it wins all four clips, 17-28 mm against 25-38 mm.
- Fingers with hands about 50 px: SAM 3D Body and GEM-X about tied, neither professional, bend error up to 18°.
- Speed for 10 s: SAM 3D Body 113-120 s, GEM-X 273-280 s.

### 2026-10-31, re-score of all four clips, `bench/matched_hands.js`, no card used

The same physical hand, the same frames, image pixels for the 2D columns. Person's left hand then right, inner 10 finger joints, degrees per frame², usable frames in brackets:

- `woman_holding_water_glass.mp4` (62, 148): SAM 3D Body raw 2.25, 1.76; smoothed 0.94, 0.48. MediaPipe world 10.26, 8.56; image 7.49, 4.88.
- `man_playing_violin.mp4` (119, 119): SAM 3D Body raw 1.18, 3.48; smoothed 0.35, 1.07. MediaPipe world 3.11, 3.77; image 3.02, 2.71. RTMW-x image 12.80, 9.80.
- `subway_guitar_busker.mp4` (106, 119): SAM 3D Body void, person switching. MediaPipe world 10.84, 12.47; image 16.09, 9.47. RTMW-x image 11.24, 23.21.
- `street_dancer.mp4` (5, 1): too few frames, no comparison.

SAM 3D Body's spread is about half MediaPipe's image spread on the woman and the violinist's left hand, and the two methods' bends barely correlate (0.40 at best). So steadiness here doesn't show accuracy.

### 2026-10-31, `woman_holding_water_glass.mp4`, ComfyUI's sample, 1280×720, 150 frames, waist-up, static camera

- SAM 3D Body bf16 through ComfyUI 0.43.0: 0.32 s a frame with hands at batch 8, 4,853 MiB peak with the desktop. 0.15 s a frame without hands, 3,925 MiB.
- Finger jitter (degrees per frame², `bench/jitter.js`), visible hands only, set with `WINDOW`: SAM 3D Body 1.0-2.2 raw, 0.21-0.52 with Gaussian window 7. MediaPipe 5.9-11.4 raw, 0.40-0.97 Gaussian, 1.2-2.5 One Euro.
- Frames 38-121: the second hand is out of frame. MediaPipe correctly reports one hand; SAM 3D Body's second hand there is a guess. Score only visible hands.
- By eye on two frames: fingers correct, including interlaced hands.

### 2026-10-31, MediaPipe alone on harder sample clips (likely AI-made), CPU, raw

- `street_dancer.mp4`, full body, fast, small hands: a hand found in 23 of 121 frames, both in 6, switching 30 times, jitter 36. Hands are in view in the sampled frames.
- `man_playing_violin.mp4`, large hands: 121 of 121, both in all, jitter 3.0-3.7.
- `subway_guitar_busker.mp4`, medium hands: 121 of 121, both in 108, jitter 8.0-12.9.

MediaPipe's model files date from 2023 (Google Storage last-modified); only its code releases are recent.
