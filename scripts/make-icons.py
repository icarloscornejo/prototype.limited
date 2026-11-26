#!/usr/bin/env python3
"""Regenerates public/favicon-32.png, public/apple-touch-icon.png and public/favicon.ico from the Prototype mark.

Standard library only, so it needs no install step. It is not part of the build: run it
by hand when the mark or the colors change, and commit the PNGs:
  python3 scripts/make-icons.py favicon > public/favicon-32.png
  python3 scripts/make-icons.py touch > public/apple-touch-icon.png
  python3 scripts/make-icons.py ico > public/favicon.ico
The geometry is the one in src/components/Mark.astro (viewBox 260 x 120).
"""
import math
import struct
import sys
import zlib

TRIANGLE = ((0.0, 0.0), (139.0, 0.0), (69.5, 120.0))
CIRCLE_CENTER = (200.0, 60.0)
CIRCLE_RADIUS = 60.0
MARK_WIDTH = 260.0
MARK_HEIGHT = 120.0

MARK_LIGHT = (0x05, 0x06, 0x09)  # --mark in light mode
MARK_DARK = (0xFC, 0xF9, 0xF8)  # --mark in dark mode
SURFACE_LIGHT = (0xF8, 0xF6, 0xF0)  # --surface in light mode

SUPERSAMPLE = 4
ICO_SIZES = (16, 32, 48)


def distance_to_segment(point: tuple[float, float], start: tuple[float, float], end: tuple[float, float]) -> float:
    segment_x, segment_y = end[0] - start[0], end[1] - start[1]
    length_squared = segment_x * segment_x + segment_y * segment_y
    along = ((point[0] - start[0]) * segment_x + (point[1] - start[1]) * segment_y) / length_squared
    along = max(0.0, min(1.0, along))
    return math.hypot(point[0] - (start[0] + along * segment_x), point[1] - (start[1] + along * segment_y))


def inside_triangle(point: tuple[float, float]) -> bool:
    signs = []
    for index in range(3):
        start, end = TRIANGLE[index], TRIANGLE[(index + 1) % 3]
        signs.append((end[0] - start[0]) * (point[1] - start[1]) - (end[1] - start[1]) * (point[0] - start[0]))
    return all(sign >= 0 for sign in signs) or all(sign <= 0 for sign in signs)


def distance_to_mark(point: tuple[float, float]) -> float:
    """Distance from a point to the mark, zero or negative inside it."""
    circle_distance = math.hypot(point[0] - CIRCLE_CENTER[0], point[1] - CIRCLE_CENTER[1]) - CIRCLE_RADIUS
    if inside_triangle(point):
        triangle_distance = 0.0
    else:
        triangle_distance = min(distance_to_segment(point, TRIANGLE[i], TRIANGLE[(i + 1) % 3]) for i in range(3))
    return min(circle_distance, triangle_distance)


def render(size: int, margin: float, mark_color: tuple[int, int, int], halo_color: tuple[int, int, int] | None,
           halo_pixels: float, background: tuple[int, int, int] | None) -> bytes:
    """RGBA bytes of the mark centered in a square, `margin` being the free fraction on each side."""
    scale = size * (1 - 2 * margin) / MARK_WIDTH  # output pixels per mark unit
    offset_x = (size - MARK_WIDTH * scale) / 2
    offset_y = (size - MARK_HEIGHT * scale) / 2
    halo_units = halo_pixels / scale
    samples = SUPERSAMPLE * SUPERSAMPLE
    rows = []
    for pixel_y in range(size):
        row = bytearray([0])  # PNG filter type 0
        for pixel_x in range(size):
            mark_hits = halo_hits = 0
            for sub_y in range(SUPERSAMPLE):
                for sub_x in range(SUPERSAMPLE):
                    # Map the sample to mark coordinates.
                    mark_x = (pixel_x + (sub_x + 0.5) / SUPERSAMPLE - offset_x) / scale
                    mark_y = (pixel_y + (sub_y + 0.5) / SUPERSAMPLE - offset_y) / scale
                    distance = distance_to_mark((mark_x, mark_y))
                    if distance <= 0:
                        mark_hits += 1
                    elif halo_color is not None and distance <= halo_units:
                        halo_hits += 1
            covered = mark_hits + halo_hits
            if background is not None:
                weight = mark_hits / samples
                red, green, blue = (round(mark_color[i] * weight + background[i] * (1 - weight)) for i in range(3))
                row += bytes((red, green, blue, 255))
            elif covered == 0:
                row += bytes((0, 0, 0, 0))
            else:
                blended = [(mark_color[i] * mark_hits + (halo_color or mark_color)[i] * halo_hits) / covered for i in range(3)]
                row += bytes((round(blended[0]), round(blended[1]), round(blended[2]), round(255 * covered / samples)))
        rows.append(bytes(row))
    return b"".join(rows)


def encode_png(size: int, rgba_rows: bytes) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8 bit RGBA
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(rgba_rows, 9)) + chunk(b"IEND", b"")


def encode_ico(pngs: list[tuple[int, bytes]]) -> bytes:
    """An ICO file whose images are the given (size, PNG bytes) pairs; PNG inside ICO is read by every current browser."""
    directory = struct.pack("<HHH", 0, 1, len(pngs))
    offset = 6 + 16 * len(pngs)
    entries = b""
    for size, png in pngs:
        entries += struct.pack("<BBBBHHII", size, size, 0, 0, 1, 32, len(png), offset)
        offset += len(png)
    return directory + entries + b"".join(png for _, png in pngs)


def main() -> None:
    # Prints one PNG to stdout: python3 scripts/make-icons.py favicon > public/favicon-32.png
    kind = sys.argv[1] if len(sys.argv) > 1 else ""
    if kind == "favicon":
        # The tab icon carries the site's own background, so the dark mark reads on light and dark tabs alike.
        png = encode_png(32, render(32, 0.06, MARK_LIGHT, None, 0.0, SURFACE_LIGHT))
    elif kind == "touch":
        png = encode_png(180, render(180, 0.2, MARK_LIGHT, None, 0.0, SURFACE_LIGHT))
    elif kind == "ico":
        # Same look as favicon.svg, whose viewBox leaves 20 of 300 units free on each side.
        png = encode_ico([(size, encode_png(size, render(size, 20 / 300, MARK_LIGHT, None, 0.0, SURFACE_LIGHT))) for size in ICO_SIZES])
    else:
        sys.exit("usage: make-icons.py favicon > public/favicon-32.png | touch > public/apple-touch-icon.png | ico > public/favicon.ico")
    sys.stdout.buffer.write(png)


if __name__ == "__main__":
    main()
