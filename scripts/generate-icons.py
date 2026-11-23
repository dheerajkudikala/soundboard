#!/usr/bin/env python3
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
ICONS = PUBLIC / "icons"
ICONS.mkdir(parents=True, exist_ok=True)

INDIGO = (99, 102, 241, 255)
VIOLET = (124, 58, 237, 255)
WHITE = (250, 250, 250, 255)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(4))


def png(size: int) -> bytes:
    radius = int(size * 0.22)
    rows = []
    bars = [
        (0.28, 0.62, 0.44),
        (0.40, 0.38, 0.68),
        (0.52, 0.28, 0.78),
        (0.64, 0.48, 0.58),
    ]
    thick = max(2, size // 18)
    for y in range(size):
        row = [0]
        for x in range(size):
            t = (x + y) / (2 * max(size - 1, 1))
            color = lerp(INDIGO, VIOLET, t)
            dx = min(x, size - 1 - x)
            dy = min(y, size - 1 - y)
            if dx < radius and dy < radius:
                ox = radius - 0.5 - dx
                oy = radius - 0.5 - dy
                if ox * ox + oy * oy > radius * radius:
                    color = (0, 0, 0, 0)
            for cx, top, bot in bars:
                bx = int(size * cx)
                y0 = int(size * top)
                y1 = int(size * bot)
                if abs(x - bx) <= thick // 2 and y0 <= y <= y1:
                    color = WHITE
            row.extend(color)
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


(PUBLIC / "apple-touch-icon.png").write_bytes(png(180))
(ICONS / "icon-192.png").write_bytes(png(192))
(ICONS / "icon-512.png").write_bytes(png(512))
print("icons written")
