"""Downloads one camera's images out of a large remote tar (Multiface keeps each camera's frames together, about 3.25 MB
a PNG), without fetching the rest, in a few dozen range requests.

Probes: a window a little larger than one entry always holds one tar header, which names the camera there. Probing
about every half camera block finds where the chosen camera lies; bisecting finds its exact first and last entries;
one range request then fetches the whole block.
Run: python -I tar_camera.py <https tar url> <camera folder name> <out dir> <frames per camera>
"""

import os
import re
import sys
import time
import urllib.request

url, camera, out_dir, frames = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
WINDOW = 3_600_000
requests_made = 0


def fetch(start, end):
    global requests_made
    for attempt in range(5):
        try:
            request = urllib.request.Request(url, headers={"Range": f"bytes={start}-{end}"})
            with urllib.request.urlopen(request, timeout=600) as response:
                if response.status != 206:
                    raise SystemExit(f"range refused: HTTP {response.status}")
                requests_made += 1
                return response.read()
        except OSError:
            if attempt == 4:
                raise
            time.sleep(5 * (attempt + 1))
    return b""


def headers_in(data, base):
    """Every valid tar header in a window: (absolute position, camera folder, file name, size)."""
    found = []
    for offset in range((-base) % 512, len(data) - 511, 512):
        block = data[offset : offset + 512]
        if block[257:262] != b"ustar":
            continue
        stored = int(block[148:156].rstrip(b"\0 ") or b"-1", 8)
        if stored != sum(block[:148]) + 8 * 32 + sum(block[156:]):
            continue
        name = block[:100].rstrip(b"\0").decode("utf-8", "replace")
        match = re.search(r"/(\d+)/(\d+\.png)$", name)
        if match:
            found.append((base + offset, match.group(1), match.group(2), int(block[124:136].rstrip(b"\0 "), 8)))
    return found


def probe(position):
    hits = headers_in(fetch(position, position + WINDOW - 1), position)
    return hits[0] if hits else None


with urllib.request.urlopen(urllib.request.Request(url, method="HEAD"), timeout=60) as response:
    total = int(response.headers["Content-Length"])
first = probe(0)
entry = 512 + (first[3] + 511) // 512 * 512
block = frames * entry
print(f"tar {total / 1e9:.2f} GB, first camera {first[1]}, about {total / block:.1f} camera blocks of {block / 1e6:.0f} MB")

# Coarse pass: find a probe inside the chosen camera's block, and the probes either side of it.
step = block // 2
inside, before, after = None, 0, total
position = 0
while position < total:
    hit = probe(position)
    if hit and hit[1] == camera:
        inside = hit[0]
        break
    if hit:
        before = hit[0]
    position += step
if inside is None:
    raise SystemExit(f"camera {camera} not found in this tar")
probe_after = probe(min(inside + block, total - WINDOW))
if probe_after and probe_after[1] != camera:
    after = probe_after[0]


def bisect(low, high, low_is_camera):
    """Narrows to the boundary between low and high, where one side is the chosen camera and the other isn't."""
    while high - low > WINDOW:
        middle = (low + high) // 2
        hit = probe(middle)
        is_camera = bool(hit) and hit[1] == camera
        if is_camera == low_is_camera:
            low = hit[0] if hit else middle
        else:
            high = middle
    return low, high


low, high = bisect(before, inside, False)
start = next(h[0] for h in headers_in(fetch(low, high + WINDOW), low) if h[1] == camera)
low, high = bisect(inside, after, True)
tail = [h for h in headers_in(fetch(low, min(high + WINDOW, total - 1)), low) if h[1] == camera]
end = tail[-1][0] + 512 + (tail[-1][3] + 511) // 512 * 512

data = fetch(start, end - 1)
os.makedirs(out_dir, exist_ok=True)
saved = 0
for position, folder, name, size in headers_in(data, start):
    if folder == camera:
        offset = position - start
        with open(os.path.join(out_dir, name), "wb") as handle:
            handle.write(data[offset + 512 : offset + 512 + size])
        saved += 1
print(f"saved {saved} frames of camera {camera}, {len(data) / 1e6:.0f} MB, {requests_made} requests")
