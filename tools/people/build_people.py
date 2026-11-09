#!/usr/bin/env python3
"""
Dress Emberhold's people.

Takes the CC0 base bodies in tools/people/base (Kevin and Keisha, from the Dramatis
character library) and writes game-ready GLBs to public/models/people:

  male.glb, female.glb  the body plus every garment the town wears, each garment its own
                        skinned mesh (the game switches them on and off per person and
                        recolours them): shirt, tunic skirt, long robe or dress skirt,
                        hose, boots, belt, apron, cloak, hood, coif, tabard, kettle helmet
  clips.glb             the Universal Animation Library clips (idle, walk, jog, sprint,
                        crouch), skeleton only

Garments are built two ways, both carrying the body's own skin weights so they bend
exactly with it:
  - shells: the body's surface over a region (torso and arms, legs, feet), pushed out
    along its normals by the cloth's thickness;
  - drapes: lathed shapes for what hangs free of the body (skirts, cloaks, aprons,
    tabards) and fitted caps for the head (hoods, coifs, helmets), weighted to the hips,
    thighs, spine or head as cloth would follow them.

Run:  python3 tools/people/build_people.py
Needs numpy and pillow.
"""
import io
import json
import math
import os
import struct
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.join(HERE, 'base')
OUT = os.path.join(HERE, '..', '..', 'public', 'models', 'people')

# ------------------------------------------------------------------ reading GLB
CT = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8, 5122: np.int16, 5120: np.int8}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def read_glb(path):
    b = open(path, 'rb').read()
    jl = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + jl])
    bl = struct.unpack('<I', b[20 + jl:24 + jl])[0]
    return j, b[28 + jl:28 + jl + bl]


def accessor(j, blob, i):
    a = j['accessors'][i]
    bv = j['bufferViews'][a['bufferView']]
    dt = np.dtype(CT[a['componentType']])
    n = NC[a['type']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride', 0)
    if stride and stride != dt.itemsize * n:
        raw = np.frombuffer(blob, np.uint8, count=stride * a['count'], offset=off).reshape(a['count'], stride)
        arr = raw[:, :dt.itemsize * n].copy().view(dt).reshape(a['count'], n)
    else:
        arr = np.frombuffer(blob, dt, count=a['count'] * n, offset=off).reshape(a['count'], n).copy()
    if a.get('normalized'):
        arr = arr.astype(np.float32) / np.iinfo(dt).max
    return arr


def image_bytes(j, blob, i):
    bv = j['bufferViews'][j['images'][i]['bufferView']]
    o = bv.get('byteOffset', 0)
    return blob[o:o + bv['byteLength']]


# ------------------------------------------------------------------ writing GLB
class Writer:
    def __init__(self):
        self.j = {'asset': {'version': '2.0', 'generator': 'emberhold build_people.py'}, 'buffers': [], 'bufferViews': [], 'accessors': [],
                  'meshes': [], 'nodes': [], 'materials': [], 'textures': [], 'images': [], 'samplers': [], 'skins': [], 'scenes': [], 'scene': 0}
        self.bin = bytearray()

    def view(self, data, target=None):
        while len(self.bin) % 4:
            self.bin.append(0)
        v = {'buffer': 0, 'byteOffset': len(self.bin), 'byteLength': len(data)}
        if target:
            v['target'] = target
        self.bin += data
        self.j['bufferViews'].append(v)
        return len(self.j['bufferViews']) - 1

    def acc(self, arr, kind, target=None, minmax=False, normalized=False):
        arr = np.ascontiguousarray(arr)
        ct = {np.dtype(np.float32): 5126, np.dtype(np.uint16): 5123, np.dtype(np.uint32): 5125, np.dtype(np.uint8): 5121}[arr.dtype]
        a = {'bufferView': self.view(arr.tobytes(), target), 'componentType': ct, 'count': int(arr.shape[0]), 'type': kind}
        if normalized:
            a['normalized'] = True
        if minmax:
            a['min'] = [float(x) for x in arr.min(0)]
            a['max'] = [float(x) for x in arr.max(0)]
        self.j['accessors'].append(a)
        return len(self.j['accessors']) - 1

    def image(self, data, mime, name):
        self.j['images'].append({'bufferView': self.view(data), 'mimeType': mime, 'name': name})
        if not self.j['samplers']:
            self.j['samplers'].append({'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497})
        self.j['textures'].append({'source': len(self.j['images']) - 1, 'sampler': 0})
        return len(self.j['textures']) - 1

    def save(self, path):
        for k in [k for k, v in self.j.items() if v == []]:
            del self.j[k]
        while len(self.bin) % 4:
            self.bin.append(0)
        self.j['buffers'] = [{'byteLength': len(self.bin)}]
        js = json.dumps(self.j, separators=(',', ':')).encode()
        while len(js) % 4:
            js += b' '
        out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(self.bin))
        out += struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(self.bin), 0x004E4942) + bytes(self.bin)
        open(path, 'wb').write(out)
        return len(out)


def jpeg(img, size, quality=84):
    im = img.convert('RGB').resize((size, size), Image.LANCZOS)
    b = io.BytesIO()
    im.save(b, 'JPEG', quality=quality, optimize=True)
    return b.getvalue()


def png(img):
    b = io.BytesIO()
    img.save(b, 'PNG', optimize=True)
    return b.getvalue()


# ------------------------------------------------------------------ procedural cloth
def tile_noise(n, freqs, seed):
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:n, 0:n] / n
    out = np.zeros((n, n))
    for f in freqs:
        for _ in range(3):
            a, b, p = rng.integers(-f, f + 1), rng.integers(-f, f + 1), rng.random() * 6.283
            out += np.sin(2 * np.pi * (a * x + b * y) + p) / f
    return (out - out.min()) / (np.ptp(out) + 1e-9)


def weave_textures(n=256, seed=1):
    """A plain-weave cloth: warp and weft threads, slubs and wear. Returns (albedo, normal)."""
    y, x = np.mgrid[0:n, 0:n] / n
    T = 48  # threads across the tile
    warp = 0.5 + 0.5 * np.cos(2 * np.pi * x * T)
    weft = 0.5 + 0.5 * np.cos(2 * np.pi * y * T)
    over = (np.floor(x * T) + np.floor(y * T)) % 2
    h = np.where(over > 0, warp * 0.7 + weft * 0.3, weft * 0.7 + warp * 0.3)
    slub = tile_noise(n, [3, 7, 13], seed)
    h = h * (0.75 + 0.25 * slub)
    albedo = 0.8 + 0.12 * h + 0.08 * (tile_noise(n, [2, 5], seed + 1) - 0.5)
    return gray_rgb(albedo), normal_from_height(h, 0.9)


def leather_textures(n=256, seed=5):
    g = tile_noise(n, [6, 14, 31], seed)
    crease = np.abs(tile_noise(n, [4, 9], seed + 3) - 0.5) * 2
    h = g * 0.6 + (1 - crease) * 0.4
    albedo = 0.6 + 0.3 * g - 0.15 * (crease < 0.08)
    return gray_rgb(albedo), normal_from_height(h, 3.0)


def gray_rgb(a):
    a = np.clip(a, 0, 1)
    return Image.fromarray((np.stack([a, a, a], -1) * 255).astype(np.uint8))


def normal_from_height(h, strength):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * strength
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * strength
    nz = np.ones_like(h)
    l = np.sqrt(dx * dx + dy * dy + nz * nz)
    rgb = np.stack([-dx / l, dy / l, nz / l], -1) * 0.5 + 0.5
    return Image.fromarray((rgb * 255).astype(np.uint8))


# ------------------------------------------------------------------ the body
class Body:
    def __init__(self, path):
        j, blob = read_glb(path)
        self.j, self.blob = j, blob
        prim = j['meshes'][0]['primitives'][0]
        A = prim['attributes']
        self.P = accessor(j, blob, A['POSITION']).astype(np.float64)
        self.N = accessor(j, blob, A['NORMAL']).astype(np.float64)
        self.UV = accessor(j, blob, A['TEXCOORD_0']).astype(np.float64)
        self.J = accessor(j, blob, A['JOINTS_0']).astype(np.int64)
        self.W = accessor(j, blob, A['WEIGHTS_0']).astype(np.float64)
        self.I = accessor(j, blob, prim['indices']).ravel().astype(np.int64)
        skin = j['skins'][0]
        self.joint_nodes = skin['joints']
        self.names = [j['nodes'][n]['name'] for n in self.joint_nodes]
        self.ji = {n: i for i, n in enumerate(self.names)}
        ibm = accessor(j, blob, skin['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
        self.jpos = np.array([np.linalg.inv(m)[:3, 3] for m in ibm])
        self.ibm_raw = accessor(j, blob, skin['inverseBindMatrices'])
        # Which way is forward? The toes point that way.
        fwd = self.at('ball_l')[2] - self.at('foot_l')[2]
        self.fz = 1.0 if fwd > 0 else -1.0
        self.left = 1.0 if self.at('thigh_l')[0] > 0 else -1.0
        self.dom = self.J[np.arange(len(self.J)), self.W.argmax(1)]

    def at(self, name):
        return self.jpos[self.ji[name]]

    def cover(self, names):
        ids = np.array([self.ji[n] for n in names if n in self.ji])
        return (np.isin(self.J, ids) * self.W).sum(1)

    def along(self, a, b):
        """Each vertex's position along the bone from joint a to joint b (0 at a, 1 at b)."""
        pa, pb = self.at(a), self.at(b)
        d = pb - pa
        return ((self.P - pa) @ d) / (d @ d)

    def fingers(self, side):
        return [n for n in self.names if n.endswith('_' + side) and any(n.startswith(f) for f in ('thumb', 'index', 'middle', 'ring', 'pinky'))]


# ------------------------------------------------------------------ garments
def shell(body, mask, offset, uv_scale=5.0):
    tri = body.I.reshape(-1, 3)
    t = tri[mask[tri].all(1)]
    used = np.unique(t)
    remap = -np.ones(len(body.P), np.int64)
    remap[used] = np.arange(len(used))
    n = body.N[used] / np.linalg.norm(body.N[used], axis=1, keepdims=True)
    return {
        'P': body.P[used] + n * offset, 'N': n, 'UV': body.UV[used] * uv_scale,
        'J': body.J[used], 'W': body.W[used], 'I': remap[t].ravel(),
    }


def radial_profile(body, y, cx, cz, exclude, bins=48, band=0.04):
    """How far the body reaches out from the axis at height y, around the compass."""
    sel = (np.abs(body.P[:, 1] - y) < band) & ~exclude
    r = np.zeros(bins)
    if sel.any():
        d = body.P[sel] - np.array([cx, 0, cz])
        ang = np.arctan2(d[:, 2], d[:, 0])
        rad = np.hypot(d[:, 0], d[:, 2])
        k = ((ang + np.pi) / (2 * np.pi) * bins).astype(int) % bins
        np.maximum.at(r, k, rad)
    # Cloth spans the gaps: take the max over neighbouring directions, then smooth.
    r = np.maximum.reduce([np.roll(r, s) for s in range(-4, 5)])
    r = np.convolve(np.concatenate([r[-3:], r, r[:3]]), np.ones(7) / 7, 'valid')
    return r


def drape(body, y_top, y_bot, *, rings=14, segs=40, margin=0.02, flare=0.0, arc=None, weights, exclude, monotonic=True, uv_scale=8.0, extra=0.0, stride=0.0):
    """A lathed hanging garment from y_top down to y_bot (arc: (centre angle, half-width) in radians)."""
    cx = 0.0
    cz = float(np.median(body.P[(np.abs(body.P[:, 1] - (y_top + y_bot) / 2) < 0.15) & ~exclude, 2])) if (~exclude).any() else 0.0
    ys = np.linspace(y_top, y_bot, rings)
    prof = None
    rows = []
    bins_ = 48
    fb = np.abs(np.sin(np.linspace(-np.pi, np.pi, bins_, endpoint=False) + np.pi / bins_))  # 1 straight ahead and behind
    for i, y in enumerate(ys):
        t = i / (rings - 1)
        r = radial_profile(body, y, cx, cz, exclude) + margin + extra + stride * fb * min(1.0, 0.35 + t * 3)
        if prof is not None and monotonic:
            r = np.maximum(r, prof)   # cloth hangs: never narrower than above
        prof = r
        rows.append(r * (1 + flare * t ** 1.4) + 0.004 * t)
    bins = len(rows[0])
    if arc:
        a0, hw = arc
        angs = np.linspace(a0 - hw, a0 + hw, segs + 1)
    else:
        angs = np.linspace(-np.pi, np.pi, segs + 1)
    P, UV, J, W = [], [], [], []
    for i, y in enumerate(ys):
        for a in angs:
            k = (a + np.pi) / (2 * np.pi) * bins
            k0 = int(np.floor(k)) % bins
            f = k - np.floor(k)
            r = rows[i][k0] * (1 - f) + rows[i][(k0 + 1) % bins] * f
            p = np.array([cx + np.cos(a) * r, y, cz + np.sin(a) * r])
            P.append(p)
            UV.append([a * uv_scale, -y * uv_scale])
            j4, w4 = weights(p, i / (rings - 1))
            J.append(j4)
            W.append(w4)
    P = np.array(P)
    cols = len(angs)
    I = []
    for i in range(rings - 1):
        for c in range(cols - 1):
            a, b, d, e = i * cols + c, i * cols + c + 1, (i + 1) * cols + c, (i + 1) * cols + c + 1
            I += [a, d, b, b, d, e]
    I = np.array(I)
    g = {'P': P, 'UV': np.array(UV), 'J': np.array(J), 'W': np.array(W), 'I': I}
    g['N'] = vertex_normals(g['P'], I)
    # Lathe winding faces inward or outward depending on the angle direction; make it outward.
    c = np.array([cx, P[:, 1].mean(), cz])
    outward = ((g['P'] - c) * g['N']).sum(1).mean()
    if outward < 0:
        g['I'] = I.reshape(-1, 3)[:, [0, 2, 1]].ravel()
        g['N'] = -g['N']
    return g


def envelope(points, centre, nth=36, nph=18, grow=2, blur=3):
    """How far the head (hair and all) reaches from its centre in each direction, smoothed:
    r(direction). Used to drape a cap that hugs the hair without following every lock."""
    d = points - centre
    r = np.linalg.norm(d, axis=1)
    th = np.arctan2(d[:, 2], d[:, 0])
    ph = np.arccos(np.clip(d[:, 1] / np.maximum(r, 1e-9), -1, 1))
    it = ((th + np.pi) / (2 * np.pi) * nth).astype(int) % nth
    ip = np.minimum((ph / np.pi * nph).astype(int), nph - 1)
    env = np.zeros((nph, nth))
    np.maximum.at(env, (ip, it), r)
    for _ in range(grow + 2):  # fill gaps from the neighbours
        e = env.copy()
        for dp in (-1, 0, 1):
            for dt in (-1, 0, 1):
                e = np.maximum(e, np.roll(np.roll(env, dt, 1), dp, 0) * (1 if dp == 0 else 1))
        env = np.where(env > 0, np.maximum(env, e * (env == 0)), e)
    for _ in range(blur):  # smooth, wrapping round the compass
        e = env.copy()
        e = (np.roll(e, 1, 1) + np.roll(e, -1, 1) + e * 2) / 4
        e[1:-1] = (e[:-2] + e[2:] + e[1:-1] * 2) / 4
        env = np.maximum(env * 0.6 + e * 0.4, e)
    env[0, :] = env[0].max()  # one radius at the crown, so the top closes without a pinch
    env[1, :] = np.maximum(env[1], env[0] * 0.98)
    def f(dirv):
        t = (math.atan2(dirv[2], dirv[0]) + np.pi) / (2 * np.pi) * nth - 0.5
        p = math.acos(max(-1.0, min(1.0, dirv[1]))) / np.pi * nph - 0.5
        t0, p0 = math.floor(t), min(max(math.floor(p), 0), nph - 2)
        ft, fp = t - t0, min(max(p - p0, 0.0), 1.0)
        a = env[p0, t0 % nth] * (1 - ft) + env[p0, (t0 + 1) % nth] * ft
        b = env[p0 + 1, t0 % nth] * (1 - ft) + env[p0 + 1, (t0 + 1) % nth] * ft
        return a * (1 - fp) + b * fp
    return f


def cap(body, centre, radii, *, phi_max, face_cut=None, segs=36, rings=14, weights, uv_scale=3.0, brim=None, env=None, pad=0.0):
    """An ellipsoidal cap over the head (hood, coif, helmet), open at the face if asked.
    With env (a function of direction), the cap hugs that envelope, pad beyond it."""
    P, UV, J, W = [], [], [], []
    rows = []
    for i in range(rings + 1):
        phi = phi_max * i / rings
        row = []
        for c in range(segs + 1):
            th = 2 * np.pi * c / segs
            d = np.array([np.sin(phi) * np.cos(th), np.cos(phi), np.sin(phi) * np.sin(th)])
            p = centre + (d * (env(d) + pad) if env else d * radii)
            row.append(len(P))
            P.append(p)
            UV.append([th * uv_scale / 6.283 * 4, phi * uv_scale])
            j4, w4 = weights(p)
            J.append(j4)
            W.append(w4)
        rows.append(row)
    I = []
    for i in range(rings):
        for c in range(segs):
            a, b, d, e = rows[i][c], rows[i][c + 1], rows[i + 1][c], rows[i + 1][c + 1]
            if face_cut and all(face_cut(P[k]) for k in (a, b, d, e)):
                continue
            I += [a, b, d, b, e, d]
    if brim:
        r_in, r_out, y = brim
        base = len(P)
        for c in range(segs + 1):
            th = 2 * np.pi * c / segs
            for r in (r_in, r_out):
                p = np.array([centre[0] + np.cos(th) * r, y, centre[2] + np.sin(th) * r * 0.95])
                P.append(p)
                UV.append([th * 3, r * 10])
                j4, w4 = weights(p)
                J.append(j4)
                W.append(w4)
        for c in range(segs):
            a, b, d, e = base + 2 * c, base + 2 * c + 1, base + 2 * c + 2, base + 2 * c + 3
            I += [a, d, b, b, d, e, a, b, d, b, e, d]
    P = np.array(P)
    I = np.array(I)
    g = {'P': P, 'UV': np.array(UV), 'J': np.array(J), 'W': np.array(W), 'I': I}
    g['N'] = vertex_normals(P, I)
    out = ((P - centre) * g['N']).sum(1).mean()
    if out < 0:
        g['I'] = I.reshape(-1, 3)[:, [0, 2, 1]].ravel()
        g['N'] = -g['N']
    return g


def cone(axis, y_top, y_bot, r_top, r_bot, *, segs=32, rings=5, weights, uv_scale=8.0):
    P, UV, J, W = [], [], [], []
    for i in range(rings):
        t = i / (rings - 1)
        y = y_top + (y_bot - y_top) * t
        rx = r_top[0] + (r_bot[0] - r_top[0]) * t
        rz = r_top[1] + (r_bot[1] - r_top[1]) * t
        for c in range(segs + 1):
            a = 2 * np.pi * c / segs
            p = np.array([axis[0] + np.cos(a) * rx, y, axis[2] + np.sin(a) * rz])
            P.append(p)
            UV.append([a * uv_scale / 6.283 * 4, y * uv_scale])
            j4, w4 = weights(p, t)
            J.append(j4)
            W.append(w4)
    I = []
    cols = segs + 1
    for i in range(rings - 1):
        for c in range(segs):
            a, b, d, e = i * cols + c, i * cols + c + 1, (i + 1) * cols + c, (i + 1) * cols + c + 1
            I += [a, d, b, b, d, e]
    P, I = np.array(P), np.array(I)
    g = {'P': P, 'UV': np.array(UV), 'J': np.array(J), 'W': np.array(W), 'I': I}
    g['N'] = vertex_normals(P, I)
    if ((P - np.array([axis[0], P[:, 1].mean(), axis[2]])) * g['N']).sum(1).mean() < 0:
        g['I'] = I.reshape(-1, 3)[:, [0, 2, 1]].ravel()
        g['N'] = -g['N']
    return g


def vertex_normals(P, I):
    t = I.reshape(-1, 3)
    fn = np.cross(P[t[:, 1]] - P[t[:, 0]], P[t[:, 2]] - P[t[:, 0]])
    N = np.zeros_like(P)
    for k in range(3):
        np.add.at(N, t[:, k], fn)
    l = np.linalg.norm(N, axis=1, keepdims=True)
    l[l == 0] = 1
    return N / l


def jw(*pairs):
    j = [0, 0, 0, 0]
    w = [0.0, 0.0, 0.0, 0.0]
    tot = sum(p[1] for p in pairs) or 1
    for k, (ji, wi) in enumerate(pairs[:4]):
        j[k] = ji
        w[k] = wi / tot
    return j, w


def smooth(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def build(body, female):
    B = body
    ji = B.ji
    y_hip = B.at('thigh_l')[1]
    y_knee = B.at('calf_l')[1]
    y_ankle = B.at('foot_l')[1]
    y_pelvis = B.at('pelvis')[1]
    y_chest = B.at('spine_03')[1]
    y_neck = B.at('neck_01')[1]
    y_shoulder = B.at('upperarm_l')[1]
    head = B.at('Head')
    arms = B.cover(['upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r', 'hand_l', 'hand_r'] + B.fingers('l') + B.fingers('r')) > 0.3
    legs = B.cover(['thigh_l', 'thigh_r', 'calf_l', 'calf_r', 'foot_l', 'foot_r', 'ball_l', 'ball_r']) > 0.5
    headv = B.cover(['Head']) > 0.5
    G = {}

    # --- shells
    # The body of the shirt: everything between the hips and a round neckline, but not the
    # arms below the shoulder (sleeves are added next), the hands, the head or the legs.
    neck_axis = B.at('neck_01')
    rh = np.hypot(B.P[:, 0] - neck_axis[0], B.P[:, 2] - neck_axis[2])
    neckline = np.where(rh < 0.085, y_neck + 0.015, y_shoulder + 0.1)
    body_part = ~(headv | (B.cover(['hand_l', 'hand_r'] + B.fingers('l') + B.fingers('r')) > 0.3) | (B.cover(['thigh_l', 'thigh_r', 'calf_l', 'calf_r', 'foot_l', 'foot_r', 'ball_l', 'ball_r']) > 0.5))
    arms_core = B.cover(['upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r', 'hand_l', 'hand_r'] + B.fingers('l') + B.fingers('r')) > 0.7
    torso = body_part & ~arms_core & (B.P[:, 1] < neckline) & (B.P[:, 1] > y_hip - 0.02)
    up = B.cover(['upperarm_l', 'upperarm_r']) > 0.2
    lo = (B.cover(['lowerarm_l', 'lowerarm_r']) > 0.4) & ((B.along('lowerarm_l', 'hand_l') < 0.86) & (B.P[:, 0] * B.left > 0) | (B.along('lowerarm_r', 'hand_r') < 0.86) & (B.P[:, 0] * B.left < 0))
    G['shirt'] = shell(B, torso | up | lo, 0.011, uv_scale=14)
    G['coat'] = shell(B, torso | up | lo, 0.02, uv_scale=14)
    hips = (B.dom == ji['pelvis']) & (B.P[:, 1] < y_hip + 0.03)
    thighs = B.cover(['thigh_l', 'thigh_r']) > 0.4
    calves = (B.cover(['calf_l', 'calf_r']) > 0.4) & (B.P[:, 1] > y_ankle + 0.02)
    G['hose'] = shell(B, hips | thighs | calves, 0.006, uv_scale=14)
    feet = B.cover(['foot_l', 'foot_r', 'ball_l', 'ball_r', 'ball_leaf_l', 'ball_leaf_r']) > 0.3
    shin_lo = (B.cover(['calf_l', 'calf_r']) > 0.4) & (B.P[:, 1] < y_ankle + (y_knee - y_ankle) * 0.45)
    G['boots'] = shell(B, feet | shin_lo, 0.012, uv_scale=3)

    # --- drapes
    cz_body = float(np.median(B.P[(np.abs(B.P[:, 1] - y_hip) < 0.1) & ~arms, 2]))
    side = lambda p: ji['thigh_l'] if p[0] * B.left > 0 else ji['thigh_r']
    calf = lambda p: ji['calf_l'] if p[0] * B.left > 0 else ji['calf_r']

    def skirt_w(stiff):
        """Skirts follow the hips at the waist and, lower down, the thigh (and shin) on their side."""
        def w(p, t):
            # Sideways from the centre line the skirt follows its own leg; straight in front of
            # or behind a leg it follows that leg closely, so a striding thigh can't push through.
            dz = abs(p[2] - cz_body)
            s_ = max(min(1.0, abs(p[0]) / 0.09), min(1.0, dz / 0.12) * 0.95)
            a = smooth(0, 1, (y_hip + 0.04 - p[1]) / max(0.05, y_hip + 0.04 - y_knee)) * stiff * s_
            below = smooth(0, 1, (y_knee - p[1]) / max(0.05, y_knee - y_ankle)) * stiff * 0.5 * s_
            if below > 0.01:
                return jw((ji['pelvis'], 1 - a), (side(p), a - below), (calf(p), below))
            return jw((ji['pelvis'], 1 - a), (side(p), a))
        return w

    torso_ex = arms | headv
    y_waist = y_pelvis + 0.07
    G['tunicSkirt'] = drape(B, y_waist, y_hip - (y_hip - y_knee) * 0.55, margin=0.032, flare=0.2, stride=0.095, weights=skirt_w(0.85), exclude=torso_ex)
    G['robeSkirt'] = drape(B, y_waist, y_ankle + 0.03, rings=18, margin=0.02, flare=0.5, stride=0.07, weights=skirt_w(0.6), exclude=torso_ex)
    G['coatSkirt'] = drape(B, y_waist, y_knee + 0.02, margin=0.03, flare=0.25, stride=0.095, weights=skirt_w(0.75), exclude=torso_ex)
    G['dressSkirt'] = drape(B, y_waist + 0.02, y_ankle + 0.015, rings=18, margin=0.02, flare=0.7, stride=0.07, weights=skirt_w(0.55), exclude=torso_ex)
    G['belt'] = drape(B, y_waist + 0.025, y_waist - 0.025, rings=2, margin=0.024, weights=lambda p, t: jw((ji['pelvis'], 1)), exclude=torso_ex)
    fwd = np.pi / 2 if B.fz > 0 else -np.pi / 2
    back = -fwd
    G['apron'] = drape(B, y_waist + 0.01, y_knee - 0.06, margin=0.03, flare=0.3, arc=(fwd, 1.0), segs=16, weights=skirt_w(0.6), exclude=torso_ex, extra=0.012)

    def spine_w(p, t):
        if p[1] > y_chest:
            return jw((ji['spine_03'], 0.7), (ji['clavicle_l'], 0.15), (ji['clavicle_r'], 0.15))
        if p[1] > y_waist:
            a = smooth(y_waist, y_chest, p[1])
            return jw((ji['spine_03'], a), (ji['spine_01'], 1 - a))
        a = smooth(0, 1, (y_waist - p[1]) / 0.5) * 0.35
        return jw((ji['pelvis'], 1 - a), (side(p), a))

    G['cloak'] = drape(B, y_shoulder + 0.02, y_knee - (y_knee - y_ankle) * 0.45, rings=18, margin=0.05, flare=0.35, arc=(back, 1.75), segs=26, weights=spine_w, exclude=arms | headv | (B.P[:, 1] > y_shoulder + 0.06))
    tab_w = spine_w
    G['tabard'] = merge(drape(B, y_shoulder - 0.02, y_hip - (y_hip - y_knee) * 0.5, rings=14, margin=0.03, arc=(fwd, 0.62), segs=12, weights=tab_w, exclude=arms | headv),
                        drape(B, y_shoulder - 0.02, y_hip - (y_hip - y_knee) * 0.5, rings=14, margin=0.03, arc=(back, 0.62), segs=12, weights=tab_w, exclude=arms | headv))

    # --- head
    hv = B.P[(B.P[:, 1] > y_neck + 0.05) & ~arms]
    lo_h, hi_h = hv.min(0), hv.max(0)
    centre = (lo_h + hi_h) / 2
    centre[1] = head[1] + (hi_h[1] - head[1]) * 0.35
    radii = (hi_h - lo_h) / 2
    # Grow the ellipsoid until every hair and scalp vertex (not the face) is inside it.
    dd = (hv - np.array([(lo_h + hi_h) / 2])) / radii
    back = (hv[:, 2] - (lo_h[2] + hi_h[2]) / 2) * B.fz < radii[2] * 0.3
    radii = radii * (np.sqrt((dd[back] ** 2).sum(1)).max() * 1.03) + 0.008
    radii[1] = hi_h[1] - centre[1] + 0.012
    face_y = (centre[1] - radii[1] * 0.85, centre[1] + radii[1] * 0.45)

    def face(p):
        d = p - centre
        ang = math.degrees(math.atan2(d[0], d[2] * B.fz))
        return abs(ang) < 62 and face_y[0] < p[1] < face_y[1]

    head_w = lambda p: jw((ji['Head'], 1)) if p[1] > y_neck + 0.06 else jw((ji['neck_01'], 0.6), (ji['Head'], 0.4))
    # A coif: linen drawn close over the hair, smooth (it hugs the hair's envelope, not each
    # lock), open at the face and tied under the chin.
    hair_env = envelope(hv, centre)
    G['coif'] = cap(B, centre, radii, phi_max=math.radians(122), face_cut=face, weights=head_w, env=hair_env, pad=0.012, segs=40, rings=18)
    # A felt cap: a low crown over the hair.
    # A beard: the lower face and jaw, pushed out a little, in the hair's colour.
    d = B.P - centre
    # Cheeks, jaw, chin and upper lip, on the front of the face only.
    jaw = headv & (B.P[:, 1] < centre[1] - radii[1] * 0.22) & (B.P[:, 1] > centre[1] - radii[1] * 1.25) & (d[:, 2] * B.fz > radii[2] * 0.05)
    G['beard'] = shell(B, jaw, 0.01, uv_scale=10)
    hood = cap(B, centre, radii * 1.08, phi_max=math.radians(122), face_cut=face, weights=head_w)
    cowl = cone(np.array([centre[0], 0, centre[2] - 0.01 * B.fz]), y_neck + 0.07, y_shoulder - 0.05, (radii[0] * 0.95, radii[2] * 0.95), (0.2, 0.15),
                weights=lambda p, t: jw((ji['neck_01'], 1 - t), (ji['spine_03'], t)))
    G['hood'] = merge(hood, cowl)
    # Hard hats sit on the skull, not on the hair: measure the head at the ears.
    ears = headv & (np.abs(B.P[:, 1] - (centre[1] - radii[1] * 0.1)) < 0.03)
    skull = np.array([np.ptp(B.P[ears, 0]) / 2, 0, np.ptp(B.P[ears, 2]) / 2]) if ears.any() else radii * 0.8
    brow = centre[1] + radii[1] * 0.2
    hat = np.array([skull[0] + 0.03, hi_h[1] - brow + 0.012, skull[2] + 0.03])
    G['helmet'] = cap(B, np.array([centre[0], brow - 0.01, centre[2]]), hat, phi_max=math.radians(90),
                      weights=lambda p: jw((ji['Head'], 1)), brim=(max(hat[0], hat[2]) - 0.004, max(hat[0], hat[2]) + 0.04, brow - 0.012))
    G['cap'] = cap(B, np.array([centre[0], brow + 0.005, centre[2]]), hat * np.array([0.98, 0.95, 0.98]), phi_max=math.radians(88), weights=lambda p: jw((ji['Head'], 1)))
    G['_unused_helmet'] = cap(B, np.array([centre[0], brow - 0.01, centre[2]]), np.array([radii[0] + 0.012, hi_h[1] - brow + 0.06, radii[2] + 0.012]), phi_max=math.radians(90),
                      weights=lambda p: jw((ji['Head'], 1)), brim=(max(radii[0], radii[2]) + 0.008, max(radii[0], radii[2]) + 0.05, brow - 0.012))
    # The skin under the clothes is never seen, and at bending joints it would push through:
    # two trimmed bodies, one for hose and tunic (head, neck, hands and feet left), one for
    # long skirts (no legs at all).
    shirt_m = torso | up | lo
    hose_m = hips | thighs | calves
    leg = (B.cover(['thigh_l', 'thigh_r', 'calf_l', 'calf_r']) > 0.5) | ((B.dom == ji['pelvis']) & (B.P[:, 1] < y_hip - 0.03))
    tri = B.I.reshape(-1, 3)
    G.pop('_unused_helmet', None)
    G['_bodyDressed'] = tri[~(shirt_m | hose_m)[tri].all(1)].ravel()
    G['_bodyRobed'] = tri[~(shirt_m | hose_m | leg)[tri].all(1)].ravel()
    return G


def merge(a, b):
    n = len(a['P'])
    out = {k: np.concatenate([np.asarray(a[k]), np.asarray(b[k])]) for k in ('P', 'N', 'UV', 'J', 'W')}
    out['I'] = np.concatenate([a['I'], b['I'] + n])
    return out


# ------------------------------------------------------------------ output
GARMENT_MAT = {
    'shirt': 'cloth', 'coat': 'cloth', 'hose': 'cloth', 'tunicSkirt': 'cloth', 'robeSkirt': 'cloth', 'coatSkirt': 'cloth',
    'dressSkirt': 'cloth', 'apron': 'cloth', 'cloak': 'cloth', 'tabard': 'cloth', 'coif': 'cloth', 'hood': 'cloth',
    'boots': 'leather', 'belt': 'leather', 'helmet': 'iron', 'cap': 'cloth', 'beard': 'hair',
}


def write_person(body, garments, path, title):
    w = Writer()
    j = body.j
    # Skeleton nodes as they were (0..64), then a node per mesh.
    nodes = [dict(n) for n in j['nodes'] if 'mesh' not in n]
    w.j['nodes'] = nodes
    ibm = w.acc(body.ibm_raw.astype(np.float32), 'MAT4')
    w.j['skins'] = [{'name': 'skeleton', 'inverseBindMatrices': ibm, 'joints': body.joint_nodes, 'skeleton': body.joint_nodes[0]}]
    imgs = {i['name']: Image.open(io.BytesIO(image_bytes(j, body.blob, k))) for k, i in enumerate(j['images'])}
    tb = w.image(jpeg(imgs['body_baseColor'], 1024), 'image/jpeg', 'body_baseColor')
    tm = w.image(jpeg(imgs['body_metallicRoughness'], 512, 80), 'image/jpeg', 'body_metallicRoughness')
    tn = w.image(jpeg(imgs['body_normal'], 1024, 88), 'image/jpeg', 'body_normal')
    ca, cn = weave_textures()
    la, ln = leather_textures()
    tca, tcn = w.image(png(ca), 'image/png', 'cloth'), w.image(png(cn), 'image/png', 'cloth_normal')
    tla, tln = w.image(png(la), 'image/png', 'leather'), w.image(png(ln), 'image/png', 'leather_normal')
    mats = {
        'body': {'name': 'body', 'pbrMetallicRoughness': {'baseColorTexture': {'index': tb}, 'metallicRoughnessTexture': {'index': tm}, 'metallicFactor': 0.0, 'roughnessFactor': 1.0},
                 'normalTexture': {'index': tn, 'scale': 1.0}},
        'cloth': {'name': 'cloth', 'pbrMetallicRoughness': {'baseColorTexture': {'index': tca}, 'metallicFactor': 0.0, 'roughnessFactor': 0.96}, 'normalTexture': {'index': tcn, 'scale': 0.45}, 'doubleSided': True},
        'leather': {'name': 'leather', 'pbrMetallicRoughness': {'baseColorTexture': {'index': tla}, 'baseColorFactor': [0.2, 0.135, 0.09, 1], 'metallicFactor': 0.0, 'roughnessFactor': 0.7}, 'normalTexture': {'index': tln, 'scale': 1.0}},
        'hair': {'name': 'hair', 'pbrMetallicRoughness': {'baseColorTexture': {'index': tla}, 'baseColorFactor': [0.08, 0.06, 0.05, 1], 'metallicFactor': 0.0, 'roughnessFactor': 0.85}, 'normalTexture': {'index': tln, 'scale': 1.4}},
        'iron': {'name': 'iron', 'pbrMetallicRoughness': {'baseColorTexture': {'index': tla}, 'baseColorFactor': [0.3, 0.3, 0.31, 1], 'metallicFactor': 0.6, 'roughnessFactor': 0.55}, 'normalTexture': {'index': tln, 'scale': 0.6}, 'doubleSided': True},
    }
    mat_index = {}
    for k, m in mats.items():
        mat_index[k] = len(w.j['materials'])
        w.j['materials'].append(m)

    def add_mesh(name, g, mat, joints_u8=True):
        P = g['P'].astype(np.float32)
        a = {
            'POSITION': w.acc(P, 'VEC3', 34962, minmax=True),
            'NORMAL': w.acc(g['N'].astype(np.float32), 'VEC3', 34962),
            'TEXCOORD_0': w.acc(g['UV'].astype(np.float32), 'VEC2', 34962),
            'JOINTS_0': w.acc(g['J'].astype(np.uint8), 'VEC4', 34962),
            'WEIGHTS_0': w.acc(g['W'].astype(np.float32), 'VEC4', 34962),
        }
        idx = g['I'].astype(np.uint16 if len(P) < 65535 else np.uint32)
        w.j['meshes'].append({'name': name, 'primitives': [{'attributes': a, 'indices': w.acc(idx, 'SCALAR', 34963), 'material': mat_index[mat]}]})
        w.j['nodes'].append({'name': name, 'mesh': len(w.j['meshes']) - 1, 'skin': 0})
        return len(w.j['nodes']) - 1

    body_g = {'P': body.P, 'N': body.N, 'UV': body.UV, 'J': body.J, 'W': body.W, 'I': body.I}
    mesh_nodes = [add_mesh('body', body_g, 'body')]
    # Same vertices, fewer triangles: reuse the body's attribute accessors.
    tris = {'body': len(body.I) // 3}
    for vname in ('bodyDressed', 'bodyRobed'):
        idx = garments.pop('_' + vname)
        prim = dict(w.j['meshes'][0]['primitives'][0])
        prim['indices'] = w.acc(idx.astype(np.uint16), 'SCALAR', 34963)
        w.j['meshes'].append({'name': vname, 'primitives': [prim]})
        w.j['nodes'].append({'name': vname, 'mesh': len(w.j['meshes']) - 1, 'skin': 0})
        mesh_nodes.append(len(w.j['nodes']) - 1)
        tris[vname] = len(idx) // 3
    for name, g in garments.items():
        mesh_nodes.append(add_mesh(name, g, GARMENT_MAT[name]))
        tris[name] = len(g['I']) // 3
    w.j['scenes'] = [{'nodes': [0] + mesh_nodes}]
    w.j['asset']['copyright'] = (f'{title}: CC0-1.0 (base body from the Dramatis character library, '
                                 'tonioloewald/dramatis3d; garments generated by tools/people/build_people.py, CC0-1.0)')
    size = w.save(path)
    return size, tris


def write_clips(path, keep):
    j, blob = read_glb(path)
    w = Writer()
    w.j['nodes'] = [{k: v for k, v in n.items() if k not in ('mesh', 'skin')} for n in j['nodes']]
    anims = []
    for a in j.get('animations', []):
        if a.get('name') not in keep:
            continue
        samplers = []
        for s in a['samplers']:
            inp = accessor(j, blob, s['input']).astype(np.float32)
            out = accessor(j, blob, s['output']).astype(np.float32)
            kind = j['accessors'][s['output']]['type']
            samplers.append({'input': w.acc(inp, 'SCALAR', minmax=True), 'output': w.acc(out, kind), 'interpolation': s.get('interpolation', 'LINEAR')})
        anims.append({'name': a['name'], 'samplers': samplers, 'channels': a['channels']})
    w.j['animations'] = anims
    roots = [i for i in range(len(j['nodes'])) if not any(i in n.get('children', []) for n in j['nodes'])]
    w.j['scenes'] = [{'nodes': roots}]
    w.j['asset']['copyright'] = 'Universal Animation Library, volume 1 (Quaternius): CC0-1.0'
    return w.save(os.path.join(OUT, 'clips.glb')), [a['name'] for a in anims]


def main():
    os.makedirs(OUT, exist_ok=True)
    report = {}
    for name, src, female, title in [('male', 'kevin.glb', False, 'eurasian-male (Kevin), AI-made character by Tonio Loewald'),
                                     ('female', 'keisha.glb', True, 'Keisha, AI-made character by Tonio Loewald')]:
        body = Body(os.path.join(BASE, src))
        g = build(body, female)
        size, tris = write_person(body, g, os.path.join(OUT, f'{name}.glb'), title)
        report[name] = {'bytes': size, 'tris': tris, 'height': float(body.P[:, 1].max())}
    size, clips = write_clips(os.path.join(BASE, 'ual-starter.glb'), {'Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Crouch_Fwd_Loop'})
    report['clips'] = {'bytes': size, 'clips': clips}
    print(json.dumps(report, indent=1))


if __name__ == '__main__':
    main()
