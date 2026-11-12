import { unzlibSync } from 'fflate'
import { GifReader } from 'omggif'
import { newImage } from './types'
import type { LayerHint, RgbaImage, SpriteSource, SpriteTag } from './types'

export function isGif(b: Uint8Array): boolean {
  return b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46
}

export function isPng(b: Uint8Array): boolean {
  return b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
}

export function isAseprite(b: Uint8Array): boolean {
  return b.length > 128 && b[4] === 0xe0 && b[5] === 0xa5
}

export function decodeGif(bytes: Uint8Array): SpriteSource {
  const reader = new GifReader(bytes as unknown as ConstructorParameters<typeof GifReader>[0])
  const { width: w, height: h } = reader
  const canvas = new Uint8ClampedArray(w * h * 4)
  const frames: RgbaImage[] = []
  const durations: number[] = []
  let pending: { x: number; y: number; w: number; h: number; restore: Uint8ClampedArray | null; mode: number } | null = null

  const clearRect = (r: { x: number; y: number; w: number; h: number }) => {
    for (let y = r.y; y < r.y + r.h; y++) canvas.fill(0, (y * w + r.x) * 4, (y * w + r.x + r.w) * 4)
  }

  for (let i = 0; i < reader.numFrames(); i++) {
    if (pending) {
      if (pending.mode === 2) clearRect(pending)
      else if (pending.mode === 3 && pending.restore) canvas.set(pending.restore)
    }
    const info = reader.frameInfo(i)
    const restore = info.disposal === 3 ? canvas.slice() : null
    reader.decodeAndBlitFrameRGBA(i, canvas as unknown as Uint8Array)
    frames.push({ w, h, data: canvas.slice() })
    durations.push(Math.max(1, info.delay) * 10)
    pending = { x: info.x, y: info.y, w: info.width, h: info.height, restore, mode: info.disposal }
  }
  return { frames, durations, tags: [], needsSlicing: false }
}

// ---------------------------------------------------------------- Aseprite

interface AseLayer { name: string; visible: boolean; type: number; level: number; opacity: number }
interface AseCel { layer: number; x: number; y: number; opacity: number; z: number; image: RgbaImage | null; link: number }

class Reader {
  p = 0
  private dv: DataView
  constructor(public b: Uint8Array) { this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength) }
  u8() { return this.b[this.p++] }
  u16() { const v = this.dv.getUint16(this.p, true); this.p += 2; return v }
  i16() { const v = this.dv.getInt16(this.p, true); this.p += 2; return v }
  u32() { const v = this.dv.getUint32(this.p, true); this.p += 4; return v }
  skip(n: number) { this.p += n }
  str() { const n = this.u16(); const s = new TextDecoder().decode(this.b.subarray(this.p, this.p + n)); this.p += n; return s }
}

function pixelsToRgba(raw: Uint8Array, w: number, h: number, depth: number, palette: number[][], transparentIdx: number): RgbaImage {
  const img = newImage(w, h)
  const d = img.data
  for (let i = 0; i < w * h; i++) {
    if (depth === 32) { d[i * 4] = raw[i * 4]; d[i * 4 + 1] = raw[i * 4 + 1]; d[i * 4 + 2] = raw[i * 4 + 2]; d[i * 4 + 3] = raw[i * 4 + 3] }
    else if (depth === 16) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = raw[i * 2]; d[i * 4 + 3] = raw[i * 2 + 1] }
    else {
      const idx = raw[i]
      const c = palette[idx] ?? [0, 0, 0, 255]
      d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]
      d[i * 4 + 3] = idx === transparentIdx ? 0 : c[3]
    }
  }
  return img
}

function blend(dst: Uint8ClampedArray, di: number, r: number, g: number, b: number, a: number): void {
  if (a <= 0) return
  const da = dst[di + 3] / 255
  const sa = a / 255
  const oa = sa + da * (1 - sa)
  if (oa <= 0) return
  for (let k = 0; k < 3; k++) {
    const s = k === 0 ? r : k === 1 ? g : b
    dst[di + k] = (s * sa + dst[di + k] * da * (1 - sa)) / oa
  }
  dst[di + 3] = oa * 255
}

export function decodeAseprite(bytes: Uint8Array): SpriteSource {
  if (!isAseprite(bytes)) throw new Error('Not an Aseprite file')
  const r = new Reader(bytes)
  r.skip(4)
  r.skip(2)
  const nFrames = r.u16()
  const w = r.u16()
  const h = r.u16()
  const depth = r.u16()
  if (depth !== 32 && depth !== 16 && depth !== 8) throw new Error('Unsupported Aseprite color depth')
  r.skip(4 + 2 + 8)
  const transparentIdx = r.u8()
  r.p = 128

  const palette: number[][] = []
  const layers: AseLayer[] = []
  const frameCels: AseCel[][] = []
  const durations: number[] = []
  const tags: SpriteTag[] = []

  for (let f = 0; f < nFrames; f++) {
    const frameStart = r.p
    const frameBytes = r.u32()
    if (r.u16() !== 0xf1fa) throw new Error('Corrupt Aseprite frame')
    const oldCount = r.u16()
    durations.push(r.u16())
    r.skip(2)
    const newCount = r.u32()
    const count = newCount === 0 ? oldCount : newCount
    const cels: AseCel[] = []
    for (let c = 0; c < count; c++) {
      const chunkStart = r.p
      const size = r.u32()
      const type = r.u16()
      if (type === 0x2004) {
        const flags = r.u16(); const ltype = r.u16(); const level = r.u16()
        r.skip(6)
        const opacity = r.u8() / 255
        r.skip(3)
        layers.push({ name: r.str(), visible: (flags & 1) !== 0, type: ltype, level, opacity })
      } else if (type === 0x2005) {
        const layer = r.u16(); const x = r.i16(); const y = r.i16(); const opacity = r.u8() / 255
        const ctype = r.u16(); const z = r.i16()
        r.skip(5)
        const cel: AseCel = { layer, x, y, opacity, z, image: null, link: -1 }
        if (ctype === 0 || ctype === 2) {
          const cw = r.u16(); const ch = r.u16()
          const data = r.b.subarray(r.p, chunkStart + size)
          const raw = ctype === 2 ? unzlibSync(data) : data
          cel.image = pixelsToRgba(raw, cw, ch, depth, palette, transparentIdx)
        } else if (ctype === 1) cel.link = r.u16()
        else { r.p = chunkStart + size; continue }
        cels.push(cel)
      } else if (type === 0x2018) {
        const n = r.u16()
        r.skip(8)
        for (let t = 0; t < n; t++) {
          const from = r.u16(); const to = r.u16()
          r.skip(1 + 2 + 6 + 3 + 1)
          tags.push({ name: r.str(), from, to })
        }
      } else if (type === 0x2019) {
        const total = r.u32(); const first = r.u32(); const last = r.u32()
        r.skip(8)
        for (let i = first; i <= last && i < total; i++) {
          const flags = r.u16()
          palette[i] = [r.u8(), r.u8(), r.u8(), r.u8()]
          if (flags & 1) r.str()
        }
      } else if (type === 0x0004) {
        const packets = r.u16()
        let idx = 0
        for (let k = 0; k < packets; k++) {
          idx += r.u8()
          const n = r.u8() || 256
          for (let i = 0; i < n; i++) palette[idx++] = [r.u8(), r.u8(), r.u8(), 255]
        }
      }
      r.p = chunkStart + size
    }
    frameCels.push(cels)
    r.p = frameStart + frameBytes
  }

  const layerVisible = (i: number): boolean => {
    let level = layers[i].level
    if (!layers[i].visible) return false
    for (let j = i - 1; j >= 0 && level > 0; j--) {
      if (layers[j].level < level) { level = layers[j].level; if (!layers[j].visible) return false }
    }
    return true
  }

  const resolve = (cel: AseCel): AseCel | null => {
    if (cel.link < 0) return cel
    const target = frameCels[cel.link]?.find((c) => c.layer === cel.layer)
    return target && target.image ? { ...cel, image: target.image } : null
  }

  const frames: RgbaImage[] = []
  const hintMasks = new Map<number, Uint8Array>()
  frameCels.forEach((cels, fi) => {
    const out = newImage(w, h)
    const ordered = cels
      .map(resolve)
      .filter((c): c is AseCel => !!c && !!c.image && layers[c.layer] !== undefined && layers[c.layer].type === 0 && layerVisible(c.layer))
      .sort((a, b) => (a.layer + a.z) - (b.layer + b.z) || a.z - b.z)
    for (const cel of ordered) {
      const img = cel.image!
      const op = cel.opacity * layers[cel.layer].opacity
      for (let y = 0; y < img.h; y++) {
        const dy = y + cel.y
        if (dy < 0 || dy >= h) continue
        for (let x = 0; x < img.w; x++) {
          const dx = x + cel.x
          if (dx < 0 || dx >= w) continue
          const si = (y * img.w + x) * 4
          const a = img.data[si + 3] * op
          if (a <= 0) continue
          blend(out.data, (dy * w + dx) * 4, img.data[si], img.data[si + 1], img.data[si + 2], a)
          if (fi === 0) {
            let m = hintMasks.get(cel.layer)
            if (!m) { m = new Uint8Array(w * h); hintMasks.set(cel.layer, m) }
            m[dy * w + dx] = 1
          }
        }
      }
    }
    frames.push(out)
  })

  const layerHints: LayerHint[] = [...hintMasks.entries()].map(([i, mask]) => ({ name: layers[i].name, mask }))
  return { frames, durations, tags, needsSlicing: false, layerHints }
}

// ---------------------------------------------------------------- Aseprite JSON sheets

interface AseJsonFrame { frame: { x: number; y: number; w: number; h: number }; duration?: number }

export function parseAsepriteJson(text: string, sheet: RgbaImage): SpriteSource {
  const json = JSON.parse(text) as {
    frames: AseJsonFrame[] | Record<string, AseJsonFrame>
    meta?: { frameTags?: { name: string; from: number; to: number }[] }
  }
  if (!json.frames) throw new Error('Not an Aseprite JSON export')
  const list = Array.isArray(json.frames) ? json.frames : Object.values(json.frames)
  const frames = list.map(({ frame: r }) => {
    const img = newImage(r.w, r.h)
    for (let y = 0; y < r.h; y++) {
      const sy = r.y + y
      if (sy < 0 || sy >= sheet.h) continue
      const x0 = Math.max(0, r.x)
      const x1 = Math.min(sheet.w, r.x + r.w)
      if (x1 <= x0) continue
      img.data.set(sheet.data.subarray((sy * sheet.w + x0) * 4, (sy * sheet.w + x1) * 4), (y * r.w + (x0 - r.x)) * 4)
    }
    return img
  })
  return {
    frames,
    durations: list.map((f) => f.duration ?? 100),
    tags: (json.meta?.frameTags ?? []).map((t) => ({ name: t.name, from: t.from, to: t.to })),
    needsSlicing: false,
  }
}
