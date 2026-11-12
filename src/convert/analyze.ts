import type { RgbaImage } from './types'

export function makeMask(img: RgbaImage, alphaThreshold: number): Uint8Array {
  const m = new Uint8Array(img.w * img.h)
  for (let i = 0; i < m.length; i++) m[i] = img.data[i * 4 + 3] >= alphaThreshold ? 1 : 0
  return m
}

export function luminance(img: RgbaImage, i: number): number {
  const d = img.data
  return (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255
}

export function rgbOf(img: RgbaImage, i: number): [number, number, number] {
  return [img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2]]
}

export function colorDist(a: number[], b: number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

export function saturation(c: number[]): number {
  const mx = Math.max(c[0], c[1], c[2])
  const mn = Math.min(c[0], c[1], c[2])
  return mx === 0 ? 0 : (mx - mn) / mx
}

/** Distance (in pixels, chamfer 3-4) from each masked pixel to the nearest unmasked pixel; 0 outside. */
export function distanceField(mask: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e9
  const d = new Float32Array(w * h)
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? INF : 0
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x])
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!mask[i]) continue
      d[i] = Math.min(d[i], at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4)
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x
      if (!mask[i]) continue
      d[i] = Math.min(d[i], at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4)
    }
  }
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? d[i] / 3 : 0
  return d
}

/** Max of `field` in a (2r+1)^2 window. */
export function localMax(field: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(field.length)
  const out = new Float32Array(field.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) m = Math.max(m, field[y * w + k])
      tmp[y * w + x] = m
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) m = Math.max(m, tmp[k * w + x])
      out[y * w + x] = m
    }
  }
  return out
}

export interface Bounds2D { x0: number; y0: number; x1: number; y1: number }

export function maskBounds(mask: Uint8Array, w: number, h: number): Bounds2D | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 }
}

const key = (c: number[]) => ((c[0] >> 4) << 8) | ((c[1] >> 4) << 4) | (c[2] >> 4)

export interface ColorCluster { id: number; size: number; pixels: number[]; color: [number, number, number] }

/** 4-connected regions of (quantised) equal colour; labels[i] = cluster index or -1. */
export function colorClusters(img: RgbaImage, mask: Uint8Array): { labels: Int32Array; clusters: ColorCluster[] } {
  const { w, h } = img
  const labels = new Int32Array(w * h).fill(-1)
  const clusters: ColorCluster[] = []
  const keys = new Int32Array(w * h)
  for (let i = 0; i < keys.length; i++) keys[i] = mask[i] ? key(rgbOf(img, i)) : -1
  const stack: number[] = []
  for (let s = 0; s < labels.length; s++) {
    if (!mask[s] || labels[s] >= 0) continue
    const id = clusters.length
    const pixels: number[] = []
    let r = 0, g = 0, b = 0
    labels[s] = id
    stack.push(s)
    while (stack.length) {
      const p = stack.pop()!
      pixels.push(p)
      r += img.data[p * 4]; g += img.data[p * 4 + 1]; b += img.data[p * 4 + 2]
      const x = p % w
      const y = (p - x) / w
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]
      for (const q of nb) {
        if (q >= 0 && labels[q] < 0 && keys[q] === keys[s]) { labels[q] = id; stack.push(q) }
      }
    }
    const n = pixels.length
    clusters.push({ id, size: n, pixels, color: [Math.round(r / n), Math.round(g / n), Math.round(b / n)] })
  }
  return { labels, clusters }
}
