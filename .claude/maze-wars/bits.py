#!/usr/bin/python3
"""1-bit bitmap helpers + a tiny PNG writer. Pure stdlib. For STUDY of the original only."""
import struct, zlib

def unpackbits(data, limit=None):
    out = bytearray(); i = 0; n = len(data)
    while i < n and (limit is None or len(out) < limit):
        c = data[i]; i += 1
        if c < 128:
            out += data[i:i+c+1]; i += c + 1
        elif c > 128:
            out += bytes([data[i]]) * (257 - c); i += 1
    return bytes(out)

class Bitmap:
    def __init__(s, w, h, fill=0):
        s.w, s.h = w, h
        s.px = [bytearray([fill]) * w for _ in range(h)]   # 1 = black
    @staticmethod
    def from_bits(data, rowbytes, w, h):
        b = Bitmap(w, h)
        for y in range(h):
            row = data[y*rowbytes:(y+1)*rowbytes]
            for x in range(w):
                if x // 8 < len(row) and (row[x // 8] >> (7 - x % 8)) & 1: b.px[y][x] = 1
        return b
    def blit(s, o, dx, dy):
        for y in range(o.h):
            yy = dy + y
            if 0 <= yy < s.h:
                for x in range(o.w):
                    xx = dx + x
                    if 0 <= xx < s.w: s.px[yy][xx] = o.px[y][x]
    def ascii(s):
        return '\n'.join(''.join('#' if v == 1 else '.' for v in row) for row in s.px)

def write_png(path, bm, scale=1, bg=None):
    """bm.px values: 0 white, 1 black, 2 = mid grey (used as canvas background)."""
    W, H = bm.w * scale, bm.h * scale
    lut = {0: 255, 1: 0, 2: 170, 3: 90}
    raw = bytearray()
    for y in range(bm.h):
        line = bytearray([0])
        for v in bm.px[y]: line += bytes([lut.get(v, 128)]) * scale
        raw += bytes(line) * scale
    def chunk(t, d): c = struct.pack('>I', len(d)) + t + d; return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', W, H, 8, 0, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b'')
    open(path, 'wb').write(png)
