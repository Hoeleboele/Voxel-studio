import type { PartId, Vec3 } from '../core/types'
import { makeMask, maskBounds } from './analyze'
import { thicknessMap } from './depth'
import { keyBackground } from './slice'
import { layerSpecs, propagateLabels, segmentSprite, specKey, PARTS } from './segment'
import type { BodyKind, LayerSpec, Segmentation } from './segment'
import { newImage } from './types'
import type { ConvertOptions, LayerHint, RgbaImage } from './types'

export interface PlacedVoxel { x: number; y: number; z: number; color: number; key: string }

export interface Reconstruction {
  specs: LayerSpec[]
  seg: Segmentation
  frames: PlacedVoxel[][] // voxels per source frame, in frame order
  size: Vec3 // voxel extent of the model
  pivots: Record<string, Vec3> // spec key -> pivot, relative to the model origin
}

export interface ReconstructOptions extends ConvertOptions {
  body: BodyKind
}

function upscale(img: RgbaImage, s: number): RgbaImage {
  if (s <= 1) return img
  const out = newImage(img.w * s, img.h * s)
  for (let y = 0; y < out.h; y++) {
    for (let x = 0; x < out.w; x++) {
      const si = (Math.floor(y / s) * img.w + Math.floor(x / s)) * 4
      out.data.set(img.data.subarray(si, si + 4), (y * out.w + x) * 4)
    }
  }
  return out
}

function upscaleMask(m: Uint8Array, w: number, h: number, s: number): Uint8Array {
  if (s <= 1) return m
  const out = new Uint8Array(w * s * h * s)
  for (let y = 0; y < h * s; y++) for (let x = 0; x < w * s; x++) out[y * w * s + x] = m[Math.floor(y / s) * w + Math.floor(x / s)]
  return out
}

function crop(img: RgbaImage, x0: number, y0: number, w: number, h: number): RgbaImage {
  const out = newImage(w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = x0 + x, sy = y0 + y
      if (sx < 0 || sy < 0 || sx >= img.w || sy >= img.h) continue
      const si = (sy * img.w + sx) * 4
      out.data.set(img.data.subarray(si, si + 4), (y * w + x) * 4)
    }
  }
  return out
}

function cropMask(m: Uint8Array, mw: number, x0: number, y0: number, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = m[(y0 + y) * mw + x0 + x] ?? 0
  return out
}

export function reconstruct(sources: RgbaImage[], opts: ReconstructOptions, hints: LayerHint[] = []): Reconstruction {
  if (sources.length === 0) throw new Error('No frames to convert')
  const s = Math.max(1, Math.min(8, Math.round(opts.scale)))
  let imgs = sources.map((f) => upscale(keyBackground(f), s))
  let hintMasks = hints
    .filter((hn) => hn.mask.length === sources[0].w * sources[0].h)
    .map((hn) => ({ name: hn.name, mask: upscaleMask(hn.mask, sources[0].w, sources[0].h, s) }))

  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1
  for (const f of imgs) {
    const b = maskBounds(makeMask(f, opts.alphaThreshold), f.w, f.h)
    if (!b) continue
    x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1)
  }
  if (x1 < 0) throw new Error('The sprite has no visible pixels')
  const W = x1 - x0 + 1
  const H = y1 - y0 + 1
  if (W > 256 || H > 256) throw new Error(`Sprite is ${W}x${H}; the model limit is 256 voxels. Lower the scale or use a smaller sprite`)
  const srcW = imgs[0].w
  imgs = imgs.map((f) => crop(f, x0, y0, W, H))
  hintMasks = hintMasks.map((hn) => ({ name: hn.name, mask: cropMask(hn.mask, srcW, x0, y0, W, H) }))

  const masks = imgs.map((f) => makeMask(f, opts.alphaThreshold))
  const seg = segmentSprite(imgs[0], masks[0], { detectLayers: opts.detectLayers, body: opts.body, hints: hintMasks })
    ?? segmentSprite(imgs.find((_f, i) => masks[i].some((v) => v === 1))!, masks.find((m) => m.some((v) => v === 1))!, { detectLayers: opts.detectLayers, body: opts.body })!

  const depth = Math.max(1, Math.round(opts.depth))
  const mid = Math.floor(depth / 2)
  const D = depth + 1
  const size: Vec3 = seg.facing === 'front' ? [W, H, D] : [D, H, W]

  const place = (px: number, py: number, z: number): [number, number, number] => {
    const y = H - 1 - py
    return seg.facing === 'front' ? [px, y, z] : seg.facing === 'right' ? [z, y, px] : [z, y, W - 1 - px]
  }
  const mapPt = (u: number, v: number): Vec3 => {
    const zc = mid + 0.5
    return seg.facing === 'front' ? [u, H - v, zc] : seg.facing === 'right' ? [zc, H - v, u] : [zc, H - v, W - u]
  }

  const frames: PlacedVoxel[][] = imgs.map((img, fi) => {
    const mask = masks[fi]
    const t = thicknessMap(img, mask, opts)
    const labels = fi === 0 ? seg : propagateLabels(seg, mask)
    const out: PlacedVoxel[] = []
    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const i = py * W + px
        if (!mask[i]) continue
        const T = Math.max(1, Math.round(t[i]))
        const key = specKey(labels.part[i], labels.sub[i])
        const r = img.data[i * 4], g = img.data[i * 4 + 1], b = img.data[i * 4 + 2]
        const z0 = opts.mode === 'relief' ? 0 : Math.max(0, Math.min(depth - T + 1, mid - Math.floor(T / 2)))
        for (let k = 0; k < T; k++) {
          const z = z0 + k
          if (opts.mode === 'shell' && k > 0 && k < T - 1) continue
          const shade = opts.mode === 'symmetric' && z < mid ? 0.8 : 1
          const col = (Math.round(r * shade) << 16) | (Math.round(g * shade) << 8) | Math.round(b * shade)
          const [x, y, zz] = place(px, py, z)
          out.push({ x, y, z: zz, color: col, key })
        }
      }
    }
    return out
  })

  const specs = layerSpecs(seg)
  // Later frames may use labels the base frame lacked; those keys fold back into the specs list.
  const known = new Set(specs.map((sp) => sp.key))
  for (const f of frames) for (const v of f) {
    if (!known.has(v.key)) { v.key = specs[0]?.key ?? v.key }
  }

  // Pivots from the base frame, in image space then mapped into voxel space.
  const box = new Map<number, { x0: number; y0: number; x1: number; y1: number; n: number }>()
  for (let i = 0; i < seg.part.length; i++) {
    const p = seg.part[i]
    if (p < 0) continue
    const x = i % W, y = Math.floor(i / W)
    const e = box.get(p) ?? { x0: x, y0: y, x1: x, y1: y, n: 0 }
    e.x0 = Math.min(e.x0, x); e.x1 = Math.max(e.x1, x); e.y0 = Math.min(e.y0, y); e.y1 = Math.max(e.y1, y); e.n++
    box.set(p, e)
  }
  const partPivot = new Map<PartId, [number, number]>()
  for (const [p, e] of box) {
    const part = PARTS[p]
    const u = (e.x0 + e.x1 + 1) / 2
    let v = (e.y0 + e.y1 + 1) / 2
    let uu = u
    if (part === 'head' || part === 'torso') v = e.y1 + 1
    else if (part.startsWith('arm') || part.startsWith('leg')) v = e.y0 + 1
    else if (part === 'tail') uu = (e.x0 + e.x1) / 2 < seg.midX ? e.x1 + 1 : e.x0
    else if (part.startsWith('wing')) uu = part === 'wingL' ? e.x1 + 1 : e.x0
    partPivot.set(part, [uu, v])
  }
  const wp = box.get(PARTS.indexOf('weapon'))
  const handBox = box.get(PARTS.indexOf('armR')) ?? box.get(PARTS.indexOf('armL'))
  if (wp && handBox) {
    const hu = (handBox.x0 + handBox.x1 + 1) / 2
    const hv = handBox.y1 + 1
    let best: [number, number] | null = null
    let bd = Infinity
    for (let i = 0; i < seg.part.length; i++) {
      if (seg.part[i] !== PARTS.indexOf('weapon')) continue
      const x = (i % W) + 0.5, y = Math.floor(i / W) + 0.5
      const d = (x - hu) ** 2 + (y - hv) ** 2
      if (d < bd) { bd = d; best = [x, y] }
    }
    if (best) partPivot.set('weapon', best)
  }
  const pivots: Record<string, Vec3> = {}
  for (const sp of specs) {
    const pv = sp.part ? partPivot.get(sp.part) : undefined
    if (pv) pivots[sp.key] = mapPt(pv[0], pv[1])
  }
  return { specs, seg, frames, size, pivots }
}
