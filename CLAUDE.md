# just-mocap

Test bench for one-camera motion capture, body and hands, from webcam or video. It exists to find the best pipeline, one
that can be used commercially and one that can't. It is not a family app yet: no app code until a pipeline wins, and then it
goes into the kit so JustDirect and JustStage share one way to do the job.

- Open work: `docs/dev/TASKS.md`. Measured results and pointers: `docs/dev/RESEARCH.md`. Unscheduled ideas: `docs/dev/IDEAS.md`.
- The research this rests on: `../just-core/docs/plans/2026-10-31-just-direct-research-mocap.md` and the notes beside it.
- `bench/` holds the test scripts and `runs.jsonl`. `node bench/mocap.js <clip in in/>` runs one clip from video to BVH, FBX, face CSV and a preview, in `out/take/<clip>/`. `in/`, `out/`, `models/` and `gemx/` hold media and weights, and git ignores them.
- JavaScript here is ES modules. `mp_hands.py` is Python because MediaPipe's tool environment is.
- The graphics card is shared. Message the other sessions before and after using it, and say "card free" when done.
- Nothing on C:. Pip, Hugging Face and temp folders point at E:.
- Say which clip a number came from. A sample clip is a baseline, never the proof: the user's own footage and eye decide.
