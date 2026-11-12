import { newImage } from './types'
import type { RgbaImage } from './types'

/** Makes a fully opaque image transparent by keying out its corner background colour. */
export function keyBackground(img: RgbaImage, tolerance = 12): RgbaImage {
  const d = img.data
  let hasAlpha = false
  for (let i = 3; i < d.length; i += 4) if (d[i] < 255) { hasAlpha = true; break }
  if (hasAlpha) return img
  const corners = [0, img.w - 1, (img.h - 1) * img.w, img.h * img.w - 1].map((p) => [d[p * 4], d[p * 4 + 1], d[p * 4 + 2]])
  const bg = corners.find((c, i) => corners.filter((o, j) => j !== i && near(o, c, 4)).length >= 1)
  if (!bg) return img
  const out: RgbaImage = { w: img.w, h: img.h, data: new Uint8ClampedArray(d) }
  // Flood from the border so interior pixels sharing the bg colour (eyes, highlights) are preserved.
  const seen = new Uint8Array(img.w * img.h)
  const stack: number[] = []
  const push = (p: number) => {
    if (seen[p]) return
    if (!near([d[p * 4], d[p * 4 + 1], d[p * 4 + 2]], bg, tolerance)) return
    seen[p] = 1
    stack.push(p)
  }
  for (let x = 0; x < img.w; x++) { push(x); push((img.h - 1) * img.w + x) }
  for (let y = 0; y < img.h; y++) { push(y * img.w); push(y * img.w + img.w - 1) }
  while (stack.length) {
    const p = stack.pop()!
    out.data[p * 4 + 3] = 0
    const x = p % img.w
    const y = (p - x) / img.w
    if (x > 0) push(p - 1)
    if (x < img.w - 1) push(p + 1)
    if (y > 0) push(p - img.w)
    if (y < img.h - 1) push(p + img.w)
  }
  return out
}

function near(a: number[], b: number[], tol: number): boolean {
  return Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol
}

/** Runs of indices with `true` flags, bridging gaps of up to `gap` empty entries. */
function runs(flags: boolean[], gap: number): [number, number][] {
  const out: [number, number][] = []
  let start = -1
  let last = -1
  for (let i = 0; i < flags.length; i++) {
    if (!flags[i]) continue
    if (start < 0) start = i
    else if (i - last - 1 > gap) { out.push([start, last]); start = i }
    last = i
  }
  if (start >= 0) out.push([start, last])
  return out
}

const median = (v: number[]): number => {
  const s = [...v].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

function copyRegion(src: RgbaImage, sx: number, sy: number, w: number, h: number, dst: RgbaImage, dx: number, dy: number): void {
  for (let y = 0; y < h; y++) {
    const yy = sy + y
    if (yy < 0 || yy >= src.h || dy + y < 0 || dy + y >= dst.h) continue
    for (let x = 0; x < w; x++) {
      const xx = sx + x
      if (xx < 0 || xx >= src.w || dx + x < 0 || dx + x >= dst.w) continue
      const si = (yy * src.w + xx) * 4
      const di = ((dy + y) * dst.w + dx + x) * 4
      dst.data[di] = src.data[si]; dst.data[di + 1] = src.data[si + 1]
      dst.data[di + 2] = src.data[si + 2]; dst.data[di + 3] = src.data[si + 3]
    }
  }
}

export function isEmptyImage(img: RgbaImage, alphaThreshold = 1): boolean {
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] >= alphaThreshold) return false
  return true
}

export interface SliceOptions {
  cols?: number
  rows?: number
  alphaThreshold?: number
}

/** Splits a sprite sheet into frames in row-major order, keeping motion inside each cell. */
export function sliceSheet(input: RgbaImage, opts: SliceOptions = {}): RgbaImage[] {
  const thr = opts.alphaThreshold ?? 1
  const img = keyBackground(input)

  if (opts.cols && opts.rows && (opts.cols > 1 || opts.rows > 1)) {
    const cw = Math.floor(img.w / opts.cols)
    const ch = Math.floor(img.h / opts.rows)
    const frames: RgbaImage[] = []
    for (let r = 0; r < opts.rows; r++) {
      for (let c = 0; c < opts.cols; c++) {
        const f = newImage(cw, ch)
        copyRegion(img, c * cw, r * ch, cw, ch, f, 0, 0)
        if (!isEmptyImage(f, thr)) frames.push(f)
      }
    }
    return frames.length ? frames : [img]
  }

  const rowFlags: boolean[] = new Array(img.h).fill(false)
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) if (img.data[(y * img.w + x) * 4 + 3] >= thr) { rowFlags[y] = true; break }
  }
  const bands = runs(rowFlags, 1)
  if (bands.length === 0) return [img]

  interface Rect { x0: number; x1: number; anchor: number }
  const bandRects = bands.map(([y0, y1]) => {
    const colFlags: boolean[] = new Array(img.w).fill(false)
    for (let x = 0; x < img.w; x++) {
      for (let y = y0; y <= y1; y++) if (img.data[(y * img.w + x) * 4 + 3] >= thr) { colFlags[x] = true; break }
    }
    const rects: Rect[] = runs(colFlags, 1).map(([x0, x1]) => ({ x0, x1, anchor: (x0 + x1 + 1) / 2 }))
    if (rects.length >= 2) {
      const centers = rects.map((r) => r.anchor)
      const pitch = median(centers.slice(1).map((c, i) => c - centers[i]))
      const origin = median(centers.map((c, i) => c - i * pitch))
      const uniform = centers.every((c, i) => Math.abs(c - (origin + i * pitch)) <= pitch * 0.25)
      if (uniform) rects.forEach((r, i) => { r.anchor = origin + i * pitch })
    }
    return { y0, y1, rects }
  })

  const total = bandRects.reduce((n, b) => n + b.rects.length, 0)
  let extent = 0
  let cellH = 0
  for (const b of bandRects) {
    cellH = Math.max(cellH, b.y1 - b.y0 + 1)
    for (const r of b.rects) extent = Math.max(extent, r.anchor - r.x0, r.x1 + 1 - r.anchor)
  }
  const cellW = Math.max(1, Math.ceil(extent) * 2)
  if (total <= 1) {
    const b = bandRects[0]
    const r = b.rects[0]
    const f = newImage(cellW, cellH)
    copyRegion(img, r.x0, b.y0, r.x1 - r.x0 + 1, b.y1 - b.y0 + 1, f, Math.round(cellW / 2 - r.anchor + r.x0), cellH - (b.y1 - b.y0 + 1))
    return [f]
  }

  const frames: RgbaImage[] = []
  for (const b of bandRects) {
    for (const r of b.rects) {
      const f = newImage(cellW, cellH)
      copyRegion(img, r.x0, b.y0, r.x1 - r.x0 + 1, b.y1 - b.y0 + 1, f, Math.round(cellW / 2 - (r.anchor - r.x0)), cellH - (b.y1 - b.y0 + 1))
      frames.push(f)
    }
  }
  return frames
}

/** Crops all frames to a shared bounding box so the voxel model is as small as it can be. */
export function cropFrames(frames: RgbaImage[], alphaThreshold = 1): RgbaImage[] {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1
  for (const f of frames) {
    for (let y = 0; y < f.h; y++) {
      for (let x = 0; x < f.w; x++) {
        if (f.data[(y * f.w + x) * 4 + 3] < alphaThreshold) continue
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) return frames
  const w = x1 - x0 + 1
  const h = y1 - y0 + 1
  return frames.map((f) => {
    const out = newImage(w, h)
    copyRegion(f, x0, y0, w, h, out, 0, 0)
    return out
  })
}
