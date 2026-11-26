#!/usr/bin/env python3
"""Render Scrollim PNG icons (16, 32, 48, 128) using supersampled SDF rasterization.
Matches icons/icon.svg with zero external dependencies (Python stdlib only).
"""

import math
import os
import struct
import zlib

SIZES = (16, 32, 48, 128)
OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")


def clamp(v: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return lo if v < lo else (hi if v > hi else v)


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def lerp_rgb(c1, c2, t: float):
    t = clamp(t)
    return (lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t))


def sd_rounded_box(px: float, py: float, cx: float, cy: float, hx: float, hy: float, r: float) -> float:
    qx = abs(px - cx) - (hx - r)
    qy = abs(py - cy) - (hy - r)
    outside = math.hypot(max(qx, 0.0), max(qy, 0.0))
    inside = min(max(qx, qy), 0.0)
    return outside + inside - r


def sd_segment(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    pax, pay = px - ax, py - ay
    bax, bay = bx - ax, by - ay
    denom = bax * bax + bay * bay
    h = clamp((pax * bax + pay * bay) / denom) if denom > 0.0 else 0.0
    return math.hypot(pax - bax * h, pay - bay * h)


def blend_over(dst, src_rgb, src_a: float):
    if src_a <= 0.0:
        return dst
    dr, dg, db, da = dst
    out_a = src_a + da * (1.0 - src_a)
    if out_a <= 0.0:
        return (0.0, 0.0, 0.0, 0.0)
    sr, sg, sb = src_rgb
    out_r = (sr * src_a + dr * da * (1.0 - src_a)) / out_a
    out_g = (sg * src_a + dg * da * (1.0 - src_a)) / out_a
    out_b = (sb * src_a + db * da * (1.0 - src_a)) / out_a
    return (out_r, out_g, out_b, out_a)


def sample_icon(x: float, y: float, aa_width: float):
    """Evaluate RGBA (0..255) at coordinate (x, y) in 0..128 design space."""
    pixel = (0.0, 0.0, 0.0, 0.0)

    # Background rounded square: x=6..122, y=6..122, r=28
    d_box = sd_rounded_box(x, y, 64.0, 64.0, 58.0, 58.0, 28.0)
    bg_alpha = clamp(0.5 - d_box / aa_width)
    if bg_alpha > 0.0:
        bg_col = lerp_rgb((23, 35, 59), (11, 18, 32), (y - 6.0) / 116.0)
        pixel = blend_over(pixel, bg_col, bg_alpha)

    # Crisp subtle border around rounded square (3px stroke centered on edge)
    d_border = abs(d_box) - 1.5
    border_alpha = clamp(0.5 - d_border / aa_width)
    if border_alpha > 0.0:
        pixel = blend_over(pixel, (51, 65, 85), border_alpha)

    # Upward chevron: (36, 52) -> (64, 26) -> (92, 52), stroke width 13 (radius 6.5)
    d_up = min(
        sd_segment(x, y, 36.0, 52.0, 64.0, 26.0),
        sd_segment(x, y, 64.0, 26.0, 92.0, 52.0),
    ) - 6.5
    up_alpha = clamp(0.5 - d_up / aa_width)
    if up_alpha > 0.0:
        t = ((x - 36.0) / 56.0 + (y - 26.0) / 26.0) * 0.5
        up_col = lerp_rgb((110, 231, 183), (16, 185, 129), t)
        pixel = blend_over(pixel, up_col, up_alpha)

    # Center dot: (64, 64), radius 7.5
    d_dot = math.hypot(x - 64.0, y - 64.0) - 7.5
    dot_alpha = clamp(0.5 - d_dot / aa_width)
    if dot_alpha > 0.0:
        pixel = blend_over(pixel, (226, 232, 240), dot_alpha)

    # Downward chevron: (36, 76) -> (64, 102) -> (92, 76), stroke width 13 (radius 6.5)
    d_down = min(
        sd_segment(x, y, 36.0, 76.0, 64.0, 102.0),
        sd_segment(x, y, 64.0, 102.0, 92.0, 76.0),
    ) - 6.5
    down_alpha = clamp(0.5 - d_down / aa_width)
    if down_alpha > 0.0:
        t = ((x - 36.0) / 56.0 + (y - 76.0) / 26.0) * 0.5
        down_col = lerp_rgb((56, 189, 248), (14, 165, 233), t)
        pixel = blend_over(pixel, down_col, down_alpha)

    return pixel


def write_png(path: str, width: int, height: int, rgba_bytes: bytes) -> None:
    def chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    raw_rows = bytearray()
    stride = width * 4
    for y in range(height):
        raw_rows.append(0)  # PNG filter type 0 (None)
        raw_rows.extend(rgba_bytes[y * stride : (y + 1) * stride])

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(bytes(raw_rows), level=9))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as f:
        f.write(png)


def render_size(size: int) -> bytes:
    ss = 4 if size >= 48 else 6
    scale = 128.0 / size
    aa_width = max(0.8, scale * 0.85)
    inv_ss2 = 1.0 / (ss * ss)
    buf = bytearray(size * size * 4)

    idx = 0
    for py in range(size):
        for px in range(size):
            ar = ag = ab = aa = 0.0
            for sy in range(ss):
                y = (py + (sy + 0.5) / ss) * scale
                for sx in range(ss):
                    x = (px + (sx + 0.5) / ss) * scale
                    r, g, b, a = sample_icon(x, y, aa_width)
                    ar += r * a
                    ag += g * a
                    ab += b * a
                    aa += a
            avg_a = aa * inv_ss2
            if avg_a > 1e-6:
                r_out = clamp(ar / aa, 0.0, 255.0)
                g_out = clamp(ag / aa, 0.0, 255.0)
                b_out = clamp(ab / aa, 0.0, 255.0)
            else:
                r_out = g_out = b_out = 0.0
            buf[idx] = int(round(r_out))
            buf[idx + 1] = int(round(g_out))
            buf[idx + 2] = int(round(b_out))
            buf[idx + 3] = int(round(clamp(avg_a) * 255.0))
            idx += 4

    return bytes(buf)


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in SIZES:
        out_path = os.path.join(OUT_DIR, f"icon{size}.png")
        rgba = render_size(size)
        write_png(out_path, size, size, rgba)
        print(f"Generated {out_path} ({size}x{size})")


if __name__ == "__main__":
    main()
