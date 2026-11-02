"""Fetches only some frames out of a Panoptic tar, with HTTP range requests, when the whole tar is too slow to download.

The tar holds one JSON per frame in frame order, about the same size each, so a frame's offset can be estimated from the
first frame and the bytes per frame. The fetched range is scanned for tar headers on 512-byte boundaries.
Run: python -I panoptic_tar_range.py <tar url> <first tar frame> <bytes per frame> <first wanted> <count> <out dir>
"""

import os
import re
import sys
import urllib.request

url, tar_first, per_frame, first, count, out_dir = sys.argv[1:7]
tar_first, per_frame, first, count = int(tar_first), float(per_frame), int(first), int(count)
MARGIN = 150  # frames either side, for frames missing from the tar and uneven sizes

start = max(0, int((first - tar_first - MARGIN) * per_frame)) // 512 * 512
end = int((first + count - tar_first + MARGIN) * per_frame)
request = urllib.request.Request(url, headers={"Range": f"bytes={start}-{end}"})
with urllib.request.urlopen(request, timeout=1800) as response:
    if response.status != 206:
        raise SystemExit(f"server ignored the range request: HTTP {response.status}")
    data = response.read()

os.makedirs(out_dir, exist_ok=True)
saved, seen, position = 0, [], 0
while position + 512 <= len(data):
    header = data[position : position + 512]
    name = header[:100].rstrip(b"\0").decode("ascii", "replace")
    match = re.fullmatch(r"[\w/]+_hd(\d+)\.json", name)
    stored = sum(header[:148]) + 8 * 32 + sum(header[156:512])
    try:
        checksum = int(header[148:156].rstrip(b"\0 ") or b"-1", 8)
    except ValueError:
        checksum = -1
    if not match or checksum != stored:
        position += 512
        continue
    size = int(header[124:136].rstrip(b"\0 "), 8)
    frame = int(match.group(1))
    seen.append(frame)
    body = data[position + 512 : position + 512 + size]
    if first <= frame < first + count and len(body) == size:
        with open(os.path.join(out_dir, os.path.basename(name)), "wb") as handle:
            handle.write(body)
        saved += 1
    position += 512 + (size + 511) // 512 * 512
print(f"bytes {len(data)}, frames in range {min(seen, default=None)}-{max(seen, default=None)}, saved {saved} of {count}")
