#!/usr/bin/python3
"""Read-only extractor for classic Mac floppy images: MFS (0xD2D7) and HFS (0x4244).
Writes each file's data fork to <out>/<name>.data and resource fork to <out>/<name>.rsrc,
plus an index.json with type/creator/sizes. Pure stdlib."""
import struct, sys, os, json

def be16(b, o): return struct.unpack_from('>H', b, o)[0]
def be32(b, o): return struct.unpack_from('>I', b, o)[0]
def safe(name): return ''.join(c if (c.isalnum() or c in ' ._-+()') else '_' for c in name)

def read_mfs(img):
    m = 1024
    nmfls   = be16(img, m+12)
    dirst   = be16(img, m+14)
    blen    = be16(img, m+16)
    nmalblk = be16(img, m+18)
    alblksz = be32(img, m+20)
    alblst  = be16(img, m+28)
    vn_len  = img[m+36]; vname = img[m+37:m+37+vn_len].decode('mac_roman')
    # 12-bit allocation map follows the MDB at m+64
    amap = {}
    base = m + 64
    for i in range(nmalblk):
        bitoff = i * 12
        byte = base + bitoff // 8
        if bitoff % 8 == 0:
            v = (img[byte] << 4) | (img[byte+1] >> 4)
        else:
            v = ((img[byte] & 0x0F) << 8) | img[byte+1]
        amap[i + 2] = v          # allocation blocks are numbered from 2
    def chain(start, loglen):
        if start == 0 or loglen == 0: return b''
        out = bytearray(); blk = start; guard = 0
        while blk not in (0, 1) and guard < 5000:
            off = alblst * 512 + (blk - 2) * alblksz
            out += img[off:off + alblksz]
            nxt = amap.get(blk, 1)
            if nxt == 1: break
            blk = nxt; guard += 1
        return bytes(out[:loglen])
    files = []
    for b in range(blen):
        p = (dirst + b) * 512; end = p + 512
        while p < end - 50:
            flags = img[p]
            if not (flags & 0x80): break
            ftype, fcreator = img[p+2:p+6], img[p+6:p+10]
            flnum = be32(img, p+18)
            dst, dlg = be16(img, p+22), be32(img, p+24)
            rst, rlg = be16(img, p+32), be32(img, p+34)
            nlen = img[p+50]; name = img[p+51:p+51+nlen].decode('mac_roman')
            files.append(dict(name=name, type=ftype.decode('mac_roman'), creator=fcreator.decode('mac_roman'),
                              data=chain(dst, dlg), rsrc=chain(rst, rlg), path=name))
            p += 51 + nlen
            if p % 2: p += 1
    return vname, files

def read_hfs(img):
    m = 1024
    alblksz = be32(img, m+20)
    alblst  = be16(img, m+28)
    vn_len  = img[m+36]; vname = img[m+37:m+37+vn_len].decode('mac_roman')
    def extents(o):
        return [(be16(img, o+i*4), be16(img, o+i*4+2)) for i in range(3)]
    xt_ext = extents(m+134); ct_ext = extents(m+150)
    xt_size = be32(img, m+130); ct_size = be32(img, m+146)
    def read_ext(exts, size=None):
        out = bytearray()
        for st, n in exts:
            if n == 0: continue
            off = alblst * 512 + st * alblksz
            out += img[off: off + n * alblksz]
        return bytes(out if size is None else out[:size])
    def leaf_records(tree):
        # header node
        first_leaf = be32(tree, 14 + 10)
        node = first_leaf
        while node:
            base = node * 512
            flink = be32(tree, base); nrecs = be16(tree, base + 10)
            for r in range(nrecs):
                ro = be16(tree, base + 512 - 2 * (r + 1))
                yield tree[base + ro: base + 512]
            node = flink
    # extents overflow: key = (forkType, fileID, startBlock)
    overflow = {}
    xt = read_ext(xt_ext, xt_size)
    if xt:
        try:
            for rec in leaf_records(xt):
                klen = rec[0]
                if klen < 7: continue
                fork = rec[1]; fid = be32(rec, 2); stblk = be16(rec, 6)
                d = 1 + klen; d += d % 2
                overflow.setdefault((fork, fid), []).append((stblk, [(be16(rec, d+i*4), be16(rec, d+i*4+2)) for i in range(3)]))
        except Exception as e:
            print('extents overflow parse issue:', e)
    ct = read_ext(ct_ext, ct_size)
    dirs = {1: '', 2: ''}
    recs = []
    for rec in leaf_records(ct):
        klen = rec[0]
        if klen == 0: continue
        parent = be32(rec, 2); nlen = rec[6]; name = rec[7:7+nlen].decode('mac_roman')
        d = 1 + klen; d += d % 2
        rtype = rec[d]
        if rtype == 1:
            dirid = be32(rec, d + 6)
            recs.append(('dir', parent, name, dirid))
        elif rtype == 2:
            ftype, fcreator = rec[d+4:d+8], rec[d+8:d+12]
            fid = be32(rec, d + 20)
            dlg = be32(rec, d + 26); rlg = be32(rec, d + 36)
            dext = [(be16(rec, d+74+i*4), be16(rec, d+74+i*4+2)) for i in range(3)]
            rext = [(be16(rec, d+86+i*4), be16(rec, d+86+i*4+2)) for i in range(3)]
            recs.append(('file', parent, name, fid, ftype, fcreator, dlg, rlg, dext, rext))
    for r in recs:
        if r[0] == 'dir': dirs[r[3]] = (r[1], r[2])
    def dpath(did):
        parts = []
        while did in dirs and dirs[did] and did not in (1,):
            if did == 2: break
            par, nm = dirs[did]; parts.append(nm); did = par
        return '/'.join(reversed(parts))
    files = []
    for r in recs:
        if r[0] != 'file': continue
        _, parent, name, fid, ftype, fcreator, dlg, rlg, dext, rext = r
        def full(exts, fork, size):
            allx = list(exts)
            for stblk, more in sorted(overflow.get((fork, fid), [])): allx += more
            return read_ext(allx, size)
        p = dpath(parent)
        files.append(dict(name=name, type=ftype.decode('mac_roman'), creator=fcreator.decode('mac_roman'),
                          data=full(dext, 0x00, dlg), rsrc=full(rext, 0xFF, rlg), path=(p + '/' if p else '') + name))
    return vname, files

def main():
    src, out = sys.argv[1], sys.argv[2]
    img = open(src, 'rb').read()
    sig = be16(img, 1024)
    if sig == 0xD2D7: vname, files = read_mfs(img); kind = 'MFS'
    elif sig == 0x4244: vname, files = read_hfs(img); kind = 'HFS'
    else: raise SystemExit('unknown signature %04x' % sig)
    os.makedirs(out, exist_ok=True)
    index = []
    print('%s volume "%s" - %d files' % (kind, vname, len(files)))
    for f in files:
        base = os.path.join(out, safe(f['path'].replace('/', '__')))
        if f['data']: open(base + '.data', 'wb').write(f['data'])
        if f['rsrc']: open(base + '.rsrc', 'wb').write(f['rsrc'])
        index.append(dict(path=f['path'], type=f['type'], creator=f['creator'], data=len(f['data']), rsrc=len(f['rsrc']), base=os.path.basename(base)))
        print('  %-34s %4s/%4s  data %7d  rsrc %7d' % (f['path'], f['type'], f['creator'], len(f['data']), len(f['rsrc'])))
    json.dump(index, open(os.path.join(out, 'index.json'), 'w'), indent=1)

if __name__ == '__main__': main()
