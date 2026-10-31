# Research

The research is in the kit repo: `../just-core/docs/plans/2026-10-31-just-direct-research-mocap.md`, with its notes and query logs in the folder beside it.
Section 9 there holds the first measured numbers. New measured results land here, one block per run, with the clip named.

## Measured

Card: RTX 2070 SUPER 8 GB, 32 GB RAM. Raw runs are in `bench/runs.jsonl`.

### 2026-10-31, `woman_holding_water_glass.mp4`, ComfyUI's sample, 1280×720, 150 frames, waist-up, static camera

- SAM 3D Body bf16 through ComfyUI 0.43.0: 0.32 s a frame with hands at batch 8, 4,853 MiB peak with the desktop. 0.15 s a frame without hands, 3,925 MiB.
- Finger jitter (degrees per frame², `bench/jitter.js`): SAM 3D Body 1.47 and 1.87 raw, 0.26 and 0.56 with Gaussian window 7. MediaPipe 8.21 and 7.37 raw, 0.73 and 0.74 Gaussian, 1.70 and 1.51 One Euro.
- MediaPipe lost one hand in 84 of 150 frames. SAM 3D Body kept both.
- By eye on two frames: fingers correct, including interlaced hands.
