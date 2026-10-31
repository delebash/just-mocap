# Research

The research is in the kit repo: `../just-core/docs/plans/2026-10-31-just-direct-research-mocap.md`, with its notes and query logs in the folder beside it.
Section 9 there holds the first measured numbers. New measured results land here, one block per run, with the clip named.

**Section 10 of that file is the audit: fifteen corrections, clean timings, matched-joint jitter on all clips, and the recommendations that survived. It replaces the numbers below where they differ.**

## Measured

Card: RTX 2070 SUPER 8 GB, 32 GB RAM. Raw runs are in `bench/runs.jsonl`.

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
