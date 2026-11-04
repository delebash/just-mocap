# Tasks

## Decisions, the user's words

- 2026-10-31: "so i want 2 options 1 best that can also be used comercially and best for non commercial"
- 2026-10-31: "should do do our tests and pipleine results in this sesion and let juststage do its other stuff we can integrate later? what do you think if you think own app testing for not tehn mak folder just-mocap and we can start testing to findthe best pipeline"
- 2026-10-31, earlier: "signle source mocap like from webcam or video full mocap including hands"; "this whould be part of just direct"; "we can take ideas and write our own code based on techniques from commercial apps"
- 2026-10-31: "simple a profressional version of ai mocap like quickmagic or many othe online singleshot or video ai to macap that can run on local machine for both commercial and non commercial use"
- 2026-10-31: "best means best quality you can get with acceptable perfomance for my machine"
- 2026-10-31: "ExMR or FlowHMR its oke not to run these yet asw they are not for commercial i what 2 iptions best non commercial best commercial"

- 2026-10-31: "you should focus on what we can user commercially first"
- 2026-10-31: "if it has no fingers that is not acceptable it has to have profressinal quality all parts"
- 2026-11-03: "your rec go", on six recs (facts in RESEARCH.md, 2026-11-03): no retargeter in the bench, since retargeting is JustStage's importer's job (`import.characterise`), with the SOMA note passed to its session; test Kimodo MotionCorrection now on walks 4648 and 13858; delete the Warp cache on C: and set `WARP_CACHE_PATH` as a user variable on E:; report SOMA-X's `rotvec_to_matrix` bug as one issue with the drafted text; film the test clip in 4K, after a 30 fps step and a chunked SAM 3D Body step in `mocap.js`; score PoseInversion with `lie_iters` 0 against the default (SOMA-X PR #21).

- 2026-11-04: "go", then "your rec go think adverserily on them", on the seven decisions reported 2026-11-04 (RESEARCH.md, "Open decisions as reported on 2026-11-04"). It covers:
  - decision 4: jaw and eye joints at rest in the body file;
  - decision 3: the lens from the phone's metadata, built only if a focal-only test shows the calibrated focal helps.

  It doesn't cover decisions 1 (floor plant) and 5 (brows), which are NOT STANDARD and wait for the word by name. Decisions 2, 6 and 7 are the user's to do.

- 2026-11-04: "dont file bug report": the GEM-X drift report is not posted. Its text stays in RESEARCH.md.
- 2026-11-04: "rethink them all adeverserily and then go on all", with "how about web cam instead of phone, you should not limit to phone", "it need to work on both iphone and webcam so dont limit ti" and "and andriod". It covers:
  - the test-clip steps for iPhone, Android and webcam;
  - `--fov`;
  - the gaze ruler for any camera;
  - the body-fallback rerun.

  The floor plant and the brows are NOT STANDARD and wait for the word by name.

- 2026-11-04: "go brows go floor plant go 3 and 4 your rec go". It covers:
  - the floor plant and the brows, in the re-attacked designs in RESEARCH.md (2026-11-04);
  - the SAM 3.1 checkpoint download, 1.75 GB, into the shared ComfyUI models folder, and the guitarist rerun with tracking;
  - the user's takes, which the user records.

## Open

1. Commercial option, first: GEM-X for body, feet and world path with contact IK, plus SAM 3D Body's fingers joined at the wrist, measured in research section 12. GEM-X runs here on native Windows, in `gemx/`. The join is built and measured (`bench/join_fingers.py`, research section 12): it keeps SAM 3D Body's finger accuracy, with 78-86% of the movement shown close up against 86-101%. Join leftovers: the movement lost in the conversion. The wrist is scored and fixed (2026-11-03, `truth_wrist.js`): GEM-X's was 24-45° off close up; the join now gives the hand SAM 3D Body's orientation relative to the arm, 14.5° on average. Face and eyes measured (research section 13): GEM-X's jaw and eyes don't move; MediaPipe Face Landmarker on a head crop follows mouth and lids at 0.95-0.99 down to a 70 px face, brows follow well when scored one-sided as ARKit defines them (up 0.86-0.91, down 0.97-0.98; corrected 2026-11-04, RESEARCH.md; keys rebuilt from the points did no better and were not kept), brow strength and gaze unmeasured. Face leftover: a gaze ruler (a Live Link Face recording from an iPhone with Face ID would give one). The body file's jaw and eye joints are written at rest since 2026-11-04 (`export_mocap.py`), because GEM-X held the eyes about 11° off; jaw and gaze go out in the face CSV. Built 2026-11-02 under "your rec … go" (research section 14): export to BVH and FBX, with the face as a Live Link Face CSV, each file checked by importing it back into Blender (0.004 mm or better); the joined fingers smoothed with SOMA's RTS smoother, default hand gains; `bench/mocap.js` runs one clip from video to files and a preview. Retargeting is not built here: it is JustStage's importer's job (`import.characterise`, its standards README), and the note on SOMA's names went to its session on 2026-11-03 (SOMA's `LeftLeg` is the thigh, HumanIK's the shin). Tested 2026-11-03 and not kept (RESEARCH.md): Kimodo MotionCorrection (floor spread down only 3-6%, pose 1-3 mm worse), and PoseInversion without refinement steps (more movement shown, slightly worse shape and bend). Tested 2026-11-04 and not kept: PoseInversion's autograd refinement at 200 steps, with and without extra hand weight (no more movement shown). Moving camera measured 2026-11-04: GEM-X's `background` mode on a turning, handheld-like camera works. It is level with our original static setup, and 7-15 mm worse on motion and hip path than a static camera with the same lens. Camera translation is untested. Still open: the floor. In GEM-X's own world the planted feet drift 26-30 cm in height over each 10 s walk (real 1.7-3.1 cm), with the original lens, the calibrated lens and the turning camera alike. GEM-X's own contact step adds it on top of a raw drift of 7-27 cm (RESEARCH.md, 2026-11-03 and 2026-11-04).
2. Commercial body fallback: SAM 3D Body. Rerun with SAM 3.1 tracking on 2026-11-04 (`run_full.js ... 1`): the guitarist is held for all 121 frames, where the one-box run jumped up to 3.2 m to passers-by (RESEARCH.md). Still open: `mocap.js` with tracking, which needs the SAM 3D Body track that matches GEM-X's person, the same across the 4K pieces.
3. Non-commercial option: ExMR through RGB MoCap. Not yet, by the user's word. The clone is in `rgbmocap/`. It needs `install.cmd`, SMPL-X, MANO and Meta's SAM 3D Body file.
4. Judge each option on a real clip of the user. Clip not supplied yet. The take (2026-11-03): one person, whole body in frame, 4K if the phone can (at 1080p full body the hands are about 50 px, where fingers measured 17-18° off), phone on a tripod at chest height, even light, sleeves off the wrists, 20-30 s of finger gestures, a turn, walking across and back, one crouch. Plus one take with the phone handheld, walking alongside (camera turns are tested, camera movement isn't). Run it with `node bench/mocap.js <clip> --focal35 <mm>`, using the phone's main-camera 35 mm figure, unless the video carries its own focal tag (the runner says which it used).

Any camera works: iPhone, Android or a webcam (the user, 2026-11-04: "how about web cam instead of phone, you should not limit to phone"; "it need to work on both iphone and webcam so dont limit ti"; "and andriod"). Put every file in `E:\Dev\Web\just-mocap\in`.
- **iPhone:** camera app, landscape, the 1× lens, 4K at 30 fps, HDR Video and Action mode off (Action mode crops the view, which changes the lens). Run with `--focal35 <the main camera's 35 mm figure>`; iOS 26 also writes its own focal tag, and the runner says whether it found one.
- **Android:** camera app, landscape, the 1× lens, 4K at 30 fps, HDR off, and stabilisation off if the app allows. Android writes no focal tag, so run with `--focal35 <the main camera's 35 mm figure from the phone's spec sheet>`.
- **Webcam:** this PC's is a Logitech HD Pro Webcam C920, at best 1920×1080 at 30 fps (MJPEG or H.264; uncompressed 1080p gives only 5 fps; checked 2026-11-04, it opens at 1080p30 MJPEG).
  - Place it about 2.7-3 m away at chest height, so a standing person fits its view (78° diagonal, about 43° vertical). Use good light, since the C920 lowers its frame rate in dim light.
  - Do a second waist-up take for the fingers: at 1080p full body the hands are about 50 px, waist-up about 100.
  - Record with OBS Studio (installed by the user, 33.0.1). Source: Video Capture Device, HD Pro Webcam C920, resolution 1920x1080, 30 fps, video format MJPEG. Settings, Video: 1920x1080 base and output, 30 fps. Settings, Output, Recording: path `E:\Dev\Web\just-mocap\in`, format mkv. The Windows Camera app saves to C:, so not that.
  - Or with ffmpeg, which copies the camera's MJPEG with no re-encoding:
    `ffmpeg -f dshow -rtbufsize 512M -video_size 1920x1080 -framerate 30 -vcodec mjpeg -i video="HD Pro Webcam C920" -c:v copy -t 40 E:\Dev\Web\just-mocap\in\webcam_full.mkv`
  - Run with `--fov 78`, Logitech's diagonal field of view for the C920.
- **Face and gaze:** a separate seated take with the gaze ruler, on any of the three cameras. Run `node bench/gaze_ruler.js` and open the printed address in a browser on this PC. Start recording with the camera beside or under the screen, press Start, follow the dot with your eyes only, and stop after the last flashes. Then score: `E:/Dev/3D/just-stage/.dev/venv-tools/Scripts/python.exe bench/truth_gaze.py in/<video> in/<schedule>.json models/face_landmarker.task`. With Live Link Face on an iPhone with Face ID, its ARKit eye angles would be a second ruler; the scorer doesn't read Live Link Face's CSV yet.

Compare against QuickMagic's output of the same clip if the user can run one.
5. Live webcam comes after video quality is proven: open question for the user, not decided.
6. End with one real shot: route A (3D guide) or route B (pose clip), research section 7.
