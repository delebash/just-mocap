# Tasks

## Decisions, the user's words

- 2026-10-31: "so i want 2 options 1 best that can also be used comercially and best for non commercial"
- 2026-10-31: "should do do our tests and pipleine results in this sesion and let juststage do its other stuff we can integrate later? what do you think if you think own app testing for not tehn mak folder just-mocap and we can start testing to findthe best pipeline"
- 2026-10-31, earlier: "signle source mocap like from webcam or video full mocap including hands"; "this whould be part of just direct"; "we can take ideas and write our own code based on techniques from commercial apps"

## Open

1. Commercial option: test SAM 3D Body on a harder clip (full body, fast motion, small hands).
2. Commercial option: test GEM-X + EgoHand. Blocked: the permission system refused the install. `bench/setup_gemx.sh` is written and unrun; the user decides.
3. Non-commercial option: test ExMR, FlowHMR and GVHMR + HandFlow through RGB MoCap. Needs the same permission, plus the user's SMPL-X and MANO registration.
4. Run the winners on a real clip of the user: full body, 1080p, hand gestures, walking. Clip not supplied yet.
5. Add cleanup to the winner: contacts, SO(3) smoothing, retarget, then export. Kimodo MotionCorrection and the SOMA smoother are the candidates.
6. Live webcam: measure RTMW with hand crops against MediaPipe with a One Euro filter, whole pipeline, on this card.
7. End with one real shot: route A (3D guide) or route B (pose clip), research section 7.
