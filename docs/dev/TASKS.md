# Tasks

## Decisions, the user's words

- 2026-10-31: "so i want 2 options 1 best that can also be used comercially and best for non commercial"
- 2026-10-31: "should do do our tests and pipleine results in this sesion and let juststage do its other stuff we can integrate later? what do you think if you think own app testing for not tehn mak folder just-mocap and we can start testing to findthe best pipeline"
- 2026-10-31, earlier: "signle source mocap like from webcam or video full mocap including hands"; "this whould be part of just direct"; "we can take ideas and write our own code based on techniques from commercial apps"
- 2026-10-31: "simple a profressional version of ai mocap like quickmagic or many othe online singleshot or video ai to macap that can run on local machine for both commercial and non commercial use"
- 2026-10-31: "best means best quality you can get with acceptable perfomance for my machine"
- 2026-10-31: "ExMR or FlowHMR its oke not to run these yet asw they are not for commercial i what 2 iptions best non commercial best commercial"

## Open

- 2026-10-31: "you should focus on what we can user commercially first"

1. Commercial option, first: GEM-X + EgoHand, with `video2mocap` (github.com/freddysae0/video2mocap) as the cleanup base, then Kimodo MotionCorrection, the SOMA smoother, retarget and export. Blocked: the permission system refuses the install, so the user runs `bench/setup_gemx.sh`. WSL isn't installed here; the script targets native Windows, unproven.
2. Commercial fallback: SAM 3D Body. Rerun the guitarist with SAM 3.1 tracking on, because the one-box run jumped to a passer-by.
3. Non-commercial option: ExMR through RGB MoCap. Not yet, by the user's word. The clone is in `rgbmocap/`. It needs `install.cmd`, SMPL-X, MANO and Meta's SAM 3D Body file.
4. Judge each option on a real clip of the user: full body, 1080p, hand gestures, walking. Clip not supplied yet. Compare against QuickMagic's output of the same clip if the user can run one.
5. Live webcam comes after video quality is proven: open question for the user, not decided.
6. End with one real shot: route A (3D guide) or route B (pose clip), research section 7.
