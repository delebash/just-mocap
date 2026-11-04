# Research

The research is in the kit repo: `../just-core/docs/plans/2026-10-31-just-direct-research-mocap.md`, with its notes and query logs in the folder beside it.
Section 9 there holds the first measured numbers. New measured results land here, one block per run, with the clip named.

**Section 10 of that file is the audit: fifteen corrections, clean timings, matched-joint jitter on all clips, and the recommendations that survived. It replaces the numbers below where they differ.**

## Measured

Card: RTX 2070 SUPER 8 GB, 32 GB RAM. Raw runs are in `bench/runs.jsonl`.

### 2026-11-04, PoseInversion autograd refinement, moving camera and lens, in progress

**The GEM-X drift issue was not posted.** Claude Code's permission check denied `gh issue create` as a public action. Its numbers also need redoing on the calibrated lens run below, since every earlier run had the wrong focal length and a distorted image. Checked against the data, the draft's hip numbers were loose: the hip-height change from the contact step, first to last half-second, is -14 and -23 cm, with a range of 23 and 26 cm (hip midpoint y in `pred_soma_params_global` minus `raw_predictions`; it equals the `transl` change, since `correct_static_pose` only replaces `body_pose`). The earlier "drops 20 cm and 24 cm" read 10 samples. No new GEM-X issue: the 28 titles are the same as on 2026-11-03.

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

So the documented 10 steps make the fit worse; 200 improve it. The full-clip finger test runs 200 steps at lr 1e-3, plain and with `autograd_leaf_weight {"hands": 3}`, against a per-chunk baseline with 0 steps (`tmp/join_autograd.ps1`).

**Lens.** Panoptic HD camera 00_07's calibrated focal length is 1395.7/1392.3 px, with strong barrel distortion (k1 -0.286, k2 0.182, k3 -0.048). GEM-X's motion step, given no intrinsics, assumes the image diagonal, 2203 px (`body_video.py:65`), and it doesn't undistort. So every Panoptic run so far had a focal length 58% too long and a distorted image. GEM-X's config takes `camera.intrinsics` (docs/DEMO.md, "Choose camera rotation handling").

**Moving camera.** GEM-X issue #24 (closed): its demo used to fall back silently to a static camera. In our version (20555be), `camera_motion.py` raises an error instead. The maintainer points to `--camera-mode vipe` on main. `bench/pan_camera.py` (new) makes two videos from each walk:
- the full frame undistorted with its calibrated intrinsics;
- a 1280×720 virtual camera at the same focal length, turning about its centre to follow the tracked person with a 0.35 s operator lag, plus a handheld wobble (pitch ±1.5°, roll ±1°, yaw jitter 0.3°). It is drawn from the source by an exact rotation homography with the lens model, with no black borders: frames are pulled in when the view would leave the source. The pan spans yaw -12.8 to 13.5° and pitch -6 to 7° on both walks.

A sliding crop wasn't used, because the background estimator takes the polar factor of K⁻¹HK, and a pure image shift comes out as only about half the turn. The true rotations are saved for GEM-X's `provided` mode. GEM-X then runs `static` with intrinsics on the undistorted video, and `background` with intrinsics on the pan (`weights/body_video_native77_static_hd0007.yaml`, `weights/body_video_native77_background_pan.yaml`; `tmp/gem_pancam.ps1`, scoring `tmp/score_pancam.ps1`).

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

Drafted issue for NVlabs/GEM-X, not posted: "Contact post-process sums vertical joint motion into the root: planted feet drift about 30 cm over 10 s. `correct_static_translation` (gem/motion/postprocess/contact.py:157-166) rebuilds the root path as the running sum of root displacement minus contact-weighted joint displacement in all three axes, smooths x and z only, then subtracts one ground_y for the whole clip, so vertical slips of joints flagged static add up in the root height. CMU Panoptic 171204_pose1, HD camera 00_07, 1080p, frames 4648-4947 and 13858-14157, static camera, body_video_native77_static.yaml, --postprocess, commit 20555be (contact.py unchanged on main 4aef145): the root height after the step minus before drops 20 cm and 24 cm over 10 s; planted ankle heights in the world output span 302 and 289 mm over stances where the measured ankle is at its planted height (measured data 17 and 31 mm; without post-processing 199 and 94 mm). A per-stance ground height for y, or keeping the raw y, would avoid the accumulation."

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
