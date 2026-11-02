# Research

The research is in the kit repo: `../just-core/docs/plans/2026-10-31-just-direct-research-mocap.md`, with its notes and query logs in the folder beside it.
Section 9 there holds the first measured numbers. New measured results land here, one block per run, with the clip named.

**Section 10 of that file is the audit: fifteen corrections, clean timings, matched-joint jitter on all clips, and the recommendations that survived. It replaces the numbers below where they differ.**

## Measured

Card: RTX 2070 SUPER 8 GB, 32 GB RAM. Raw runs are in `bench/runs.jsonl`.

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
