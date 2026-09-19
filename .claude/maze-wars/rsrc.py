#!/usr/bin/python3
"""Classic Mac resource fork parser. Pure stdlib."""
import struct, sys, collections

def be16(b, o): return struct.unpack_from('>H', b, o)[0]
def be16s(b, o): return struct.unpack_from('>h', b, o)[0]
def be32(b, o): return struct.unpack_from('>I', b, o)[0]

class Res:
    __slots__ = ('type', 'id', 'name', 'attrs', 'data')
    def __init__(s, t, i, n, a, d): s.type, s.id, s.name, s.attrs, s.data = t, i, n, a, d

def parse(path):
    b = open(path, 'rb').read()
    doff, moff, dlen, mlen = struct.unpack_from('>IIII', b, 0)
    tl = moff + be16(b, moff + 24)
    nl = moff + be16(b, moff + 26)
    ntypes = be16(b, tl) + 1
    out = []
    for t in range(ntypes):
        e = tl + 2 + t * 8
        rtype = b[e:e+4].decode('mac_roman')
        count = be16(b, e + 4) + 1
        roff = tl + be16(b, e + 6)
        for r in range(count):
            re_ = roff + r * 12
            rid = be16s(b, re_)
            noff = be16(b, re_ + 2)
            attrs = b[re_ + 4]
            d = doff + (be32(b, re_ + 4) & 0xFFFFFF)
            ln = be32(b, d)
            name = ''
            if noff != 0xFFFF:
                p = nl + noff; name = b[p+1:p+1+b[p]].decode('mac_roman')
            out.append(Res(rtype, rid, name, attrs, b[d+4:d+4+ln]))
    return out

if __name__ == '__main__':
    res = parse(sys.argv[1])
    by = collections.OrderedDict()
    for r in res: by.setdefault(r.type, []).append(r)
    verbose = len(sys.argv) > 2
    for t, rs in by.items():
        tot = sum(len(r.data) for r in rs)
        print('%-4s  x%-4d total %7d' % (t, len(rs), tot))
        if verbose or len(rs) <= 40:
            for r in sorted(rs, key=lambda r: r.id):
                print('        %6d  %6d  %s' % (r.id, len(r.data), r.name))
