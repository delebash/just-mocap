// Gaze ruler: serves bench/gaze/index.html on this computer only and saves its dot schedule as in/gaze_<time>.json. Any
// camera records the face meanwhile (iPhone, Android, a webcam through OBS); the page's white flashes mark its clock in
// the video, and truth_gaze.py lines the two up. Only 127.0.0.1 can reach this server.
// Run: node bench/gaze_ruler.js, then open the printed address in a browser on this computer.
import { createReadStream, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const inbox = join(here, "..", "in");
const NAME = /^gaze_[0-9A-Za-z_]{1,40}$/;
mkdirSync(inbox, { recursive: true });

function reply(res, status, text) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(text);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  try {
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return void createReadStream(join(here, "gaze", "index.html")).pipe(res);
    }
    const name = url.searchParams.get("name") ?? "";
    if (req.method === "POST" && url.pathname === "/schedule" && NAME.test(name)) {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 1 << 20) return reply(res, 413, "schedule too large");
      }
      const file = join(inbox, `${name}.json`);
      writeFileSync(file, JSON.stringify(JSON.parse(body), null, 1), { flag: "wx" });
      console.log(`saved ${file}\nscore it from E:\\Dev\\Web\\just-mocap with:\n  E:/Dev/3D/just-stage/.dev/venv-tools/Scripts/python.exe bench/truth_gaze.py in/<your video> in/${name}.json models/face_landmarker.task`);
      return reply(res, 200, `It is in ${inbox}.`);
    }
    reply(res, 404, "not found");
  } catch (error) {
    console.error(error);
    reply(res, 500, String(error.message ?? error));
  }
});
server.listen(0, "127.0.0.1", () => console.log(`gaze ruler: open http://127.0.0.1:${server.address().port}/ in a browser; Ctrl+C stops it`));
