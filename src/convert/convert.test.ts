import { GIFEncoder } from 'gifenc'
import { zlibSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { decodeAseprite, decodeGif, parseAsepriteJson } from './decode'
import { makeMask } from './analyze'
import { reconstruct } from './reconstruct'
import { PARTS, segmentSprite } from './segment'
import { sliceSheet } from './slice'
import { DEFAULT_CONVERT, newImage } from './types'
import type { RgbaImage } from './types'
import { thicknessMap } from './depth'

function rect(img: RgbaImage, x0: number, y0: number, w: number, h: number, c: [number, number, number]): void {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const i = (y * img.w + x) * 4
      img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255
    }
  }
}

const SKIN: [number, number, number] = [240, 190, 150]

/** 24x32 front-facing humanoid: head, torso, two arms, two legs with a gap between them. */
function humanoid(armShift = 0): RgbaImage {
  const img = newImage(24, 32)
  rect(img, 8, 0, 8, 8, SKIN)
  rect(img, 10, 3, 1, 1, [20, 20, 20])
  rect(img, 13, 3, 1, 1, [20, 20, 20])
  rect(img, 9, 8, 6, 1, SKIN)
  rect(img, 8, 9, 8, 9, [180, 40, 40])
  rect(img, 6, 9 + armShift, 2, 9, SKIN)
  rect(img, 16, 9 + armShift, 2, 9, SKIN)
  rect(img, 8, 18, 3, 10, [40, 60, 160])
  rect(img, 13, 18, 3, 10, [40, 60, 160])
  return img
}

describe('segmentation', () => {
  it('labels a front-facing humanoid into body parts', () => {
    const img = humanoid()
    const seg = segmentSprite(img, makeMask(img, 128), { detectLayers: true, body: 'auto' })!
    const at = (x: number, y: number) => PARTS[seg.part[y * img.w + x]]
    expect(seg.kind).toBe('biped')
    expect(seg.facing).toBe('front')
    expect(at(12, 2)).toBe('head')
    expect(at(12, 13)).toBe('torso')
    expect(at(6, 13)).toBe('armL')
    expect(at(17, 13)).toBe('armR')
    expect(at(9, 24)).toBe('legL')
    expect(at(14, 24)).toBe('legR')
  })

  it('treats the sprite as a single prop layer when layer detection is off', () => {
    const img = humanoid()
    const seg = segmentSprite(img, makeMask(img, 128), { detectLayers: false, body: 'auto' })!
    expect(seg.kind).toBe('prop')
  })
})

describe('depth', () => {
  it('is thicker in the middle of a blob than at its rim', () => {
    const img = newImage(20, 20)
    rect(img, 2, 2, 16, 16, [200, 200, 200])
    const t = thicknessMap(img, makeMask(img, 128), { depth: 8, shadingBias: 0, smoothing: 0 })
    expect(t[10 * 20 + 10]).toBeGreaterThan(t[10 * 20 + 2])
    expect(t[10 * 20 + 10]).toBeLessThanOrEqual(8)
    expect(t[0]).toBe(0)
  })
})

describe('reconstruct', () => {
  it('builds tagged layers with pivots and one voxel set per frame', () => {
    const r = reconstruct([humanoid(), humanoid(1)], { ...DEFAULT_CONVERT, body: 'auto' })
    expect(r.frames).toHaveLength(2)
    expect(r.frames[0].length).toBeGreaterThan(300)
    const parts = r.specs.map((s) => s.part)
    for (const p of ['head', 'torso', 'armL', 'armR', 'legL', 'legR']) expect(parts).toContain(p)
    const head = r.specs.find((s) => s.part === 'head')!
    expect(r.pivots[head.key]).toBeDefined()
    expect(r.size[1]).toBe(28)
    for (const v of r.frames[1]) expect(r.specs.some((s) => s.key === v.key)).toBe(true)
  })

  it('is mirror symmetric for a symmetric sprite', () => {
    const r = reconstruct([humanoid()], { ...DEFAULT_CONVERT, body: 'auto' })
    const set = new Set(r.frames[0].map((v) => `${v.x},${v.y},${v.z}`))
    const w = r.size[0]
    for (const v of r.frames[0]) expect(set.has(`${w - 1 - v.x},${v.y},${v.z}`)).toBe(true)
  })

  it('maps side-facing sprites onto the X axis for depth', () => {
    const img = newImage(20, 20)
    rect(img, 2, 2, 12, 16, [150, 150, 150])
    const r = reconstruct([img], { ...DEFAULT_CONVERT, body: 'biped', depth: 4 })
    expect(r.seg.facing === 'front' ? r.size[2] : r.size[0]).toBe(5)
  })
})

describe('sheet slicing', () => {
  it('finds frames separated by transparent gutters', () => {
    const sheet = newImage(60, 20)
    for (let i = 0; i < 3; i++) rect(sheet, 3 + i * 20, 4, 10, 14, [100 + i * 40, 50, 50])
    const frames = sliceSheet(sheet)
    expect(frames).toHaveLength(3)
    expect(frames[1].data[(frames[1].h - 1) * frames[1].w * 4 + (frames[1].w / 2) * 4 + 3]).toBe(255)
  })

  it('splits by manual columns and rows', () => {
    const sheet = newImage(40, 40)
    rect(sheet, 1, 1, 5, 5, [255, 0, 0]); rect(sheet, 21, 1, 5, 5, [0, 255, 0])
    rect(sheet, 1, 21, 5, 5, [0, 0, 255]); rect(sheet, 21, 21, 5, 5, [255, 255, 0])
    expect(sliceSheet(sheet, { cols: 2, rows: 2 })).toHaveLength(4)
  })

  it('keys out an opaque background colour', () => {
    const sheet = newImage(30, 10)
    rect(sheet, 0, 0, 30, 10, [255, 0, 255])
    rect(sheet, 2, 2, 4, 6, [10, 200, 10]); rect(sheet, 20, 2, 4, 6, [10, 200, 10])
    expect(sliceSheet(sheet)).toHaveLength(2)
  })
})

describe('decoders', () => {
  it('decodes frames from an animated GIF', () => {
    const gif = GIFEncoder()
    const palette = [[0, 0, 0], [255, 0, 0], [0, 255, 0]]
    for (let f = 0; f < 3; f++) {
      const idx = new Uint8Array(16).fill(f === 0 ? 1 : 2)
      gif.writeFrame(idx, 4, 4, { palette, delay: 80, repeat: 0 })
    }
    gif.finish()
    const src = decodeGif(gif.bytes())
    expect(src.frames).toHaveLength(3)
    expect(src.durations[0]).toBe(80)
    expect(Array.from(src.frames[0].data.slice(0, 4))).toEqual([255, 0, 0, 255])
    expect(Array.from(src.frames[2].data.slice(0, 4))).toEqual([0, 255, 0, 255])
  })

  it('parses an Aseprite JSON sheet export', () => {
    const sheet = newImage(8, 4)
    rect(sheet, 0, 0, 4, 4, [255, 0, 0]); rect(sheet, 4, 0, 4, 4, [0, 0, 255])
    const json = JSON.stringify({
      frames: { a: { frame: { x: 0, y: 0, w: 4, h: 4 }, duration: 50 }, b: { frame: { x: 4, y: 0, w: 4, h: 4 }, duration: 70 } },
      meta: { frameTags: [{ name: 'run', from: 0, to: 1 }] },
    })
    const src = parseAsepriteJson(json, sheet)
    expect(src.frames).toHaveLength(2)
    expect(src.durations).toEqual([50, 70])
    expect(src.tags[0].name).toBe('run')
    expect(src.frames[1].data[0]).toBe(0)
    expect(src.frames[1].data[2]).toBe(255)
  })

  it('decodes a hand-built Aseprite file with a compressed cel and layer hint', () => {
    const bytes = buildAseprite()
    const src = decodeAseprite(bytes)
    expect(src.frames).toHaveLength(1)
    expect(Array.from(src.frames[0].data.slice(0, 4))).toEqual([10, 20, 30, 255])
    expect(src.layerHints?.[0].name).toBe('weapon')
    expect(src.layerHints?.[0].mask.filter((v) => v === 1)).toHaveLength(4)
  })
})

function buildAseprite(): Uint8Array {
  const parts: number[] = []
  const u16 = (v: number) => parts.push(v & 255, (v >> 8) & 255)
  const u32 = (v: number) => parts.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255)
  const chunk = (type: number, body: number[]) => ({ type, body })
  const str = (s: string) => [s.length & 255, 0, ...[...s].map((c) => c.charCodeAt(0))]

  const layerBody = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, ...str('weapon')]
  const px = new Uint8Array(2 * 2 * 4)
  for (let i = 0; i < 4; i++) px.set([10, 20, 30, 255], i * 4)
  const z = zlibSync(px)
  const celBody = [0, 0, 0, 0, 0, 0, 255, 2, 0, /* z + reserved */ 0, 0, 0, 0, 0, 0, 0, 2, 0, 2, 0, ...z]
  const chunks = [chunk(0x2004, layerBody), chunk(0x2005, celBody)]
  const chunkBytes = chunks.map((c) => {
    const size = 6 + c.body.length
    return [size & 255, (size >> 8) & 255, 0, 0, c.type & 255, (c.type >> 8) & 255, ...c.body]
  })
  const frameSize = 16 + chunkBytes.reduce((n, c) => n + c.length, 0)
  const total = 128 + frameSize

  u32(total); u16(0xa5e0); u16(1); u16(2); u16(2); u16(32); u32(1); u16(100)
  while (parts.length < 128) parts.push(0)
  u32(frameSize); u16(0xf1fa); u16(chunks.length); u16(100); parts.push(0, 0); u32(chunks.length)
  for (const c of chunkBytes) parts.push(...c)
  return new Uint8Array(parts)
}
