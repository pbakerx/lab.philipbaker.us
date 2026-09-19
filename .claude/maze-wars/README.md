# Tools used to study the original Maze Wars+ (1986)

Pure-stdlib Python, written for the rebuild in `/maze-wars`. They read Philip's own copy of the
game (`Maze-Wars_Mac_EN.zip`: two floppy images, v1.0 MFS and v1.1 HFS). **The disk images and
anything extracted from them stay out of this repo** — it is public, and the art is MacroMind's.

- `macdisk.py <image.dsk> <outdir>` — extracts every file's data and resource fork from an MFS
  (0xD2D7) or HFS (0x4244) floppy image.
- `rsrc.py <file.rsrc> [-v]` — lists a resource fork; `rsrc.parse()` returns the resources.
- `bits.py` — PackBits, 1-bit bitmaps, a tiny PNG writer (for contact sheets while studying).

What they established is written up in the repo's `CLAUDE.md` under **/maze-wars**.
