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

## Open

1. Commercial option, first: GEM-X for body, feet and world path with contact IK, plus SAM 3D Body's fingers joined at the wrist, measured in research section 12. GEM-X runs here on native Windows, in `gemx/`. The join is built and measured (`bench/join_fingers.py`, research section 12): it keeps SAM 3D Body's finger accuracy, with 78-86% of the movement shown close up against 86-101%. Join leftovers: the wrist keeps GEM-X's rotation and isn't scored; the movement lost in the conversion. Face and eyes measured (research section 13): GEM-X's jaw and eyes don't move; MediaPipe Face Landmarker on a head crop follows mouth and lids at 0.95-0.99 down to a 70 px face, brows weaker (blendshapes 0.73-0.82), gaze unmeasured. Face leftovers: a gaze ruler (a Live Link Face recording from an iPhone with Face ID would give one), and jaw and eye joints in the body file (the face goes out as ARKit curves). Built 2026-11-02 under "your rec … go" (research section 14): export to BVH and FBX, with the face as a Live Link Face CSV, each file checked by importing it back into Blender (0.004 mm or better); the joined fingers smoothed with SOMA's RTS smoother, default hand gains; `bench/mocap.js` runs one clip from video to files and a preview. Still open, each waiting for the user's word: retarget to the UE5 skeleton JustStage approved on 2026-10-29; Kimodo MotionCorrection, only if a real clip shows floor or pop problems.
2. Commercial body fallback: SAM 3D Body. Rerun the guitarist with SAM 3.1 tracking on, because the one-box run jumped to a passer-by.
3. Non-commercial option: ExMR through RGB MoCap. Not yet, by the user's word. The clone is in `rgbmocap/`. It needs `install.cmd`, SMPL-X, MANO and Meta's SAM 3D Body file.
4. Judge each option on a real clip of the user: full body, 1080p, hand gestures, walking. Clip not supplied yet. Compare against QuickMagic's output of the same clip if the user can run one.
5. Live webcam comes after video quality is proven: open question for the user, not decided.
6. End with one real shot: route A (3D guide) or route B (pose clip), research section 7.
