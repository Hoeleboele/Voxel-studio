import { LayerInfo } from '../core/layers'
import { fromRgb, quantizeColors, rgb } from '../core/color'
import type { Layer } from '../core/types'
import type { VoxelGrid } from '../core/voxelGrid'

class Writer {
  private parts: number[] = []
  u32(v: number): void { this.parts.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255) }
  u8(v: number): void { this.parts.push(v & 255) }
  tag(s: string): void { for (let i = 0; i < 4; i++) this.parts.push(s.charCodeAt(i)) }
  bytes(): Uint8Array { return Uint8Array.from(this.parts) }
  get length(): number { return this.parts.length }
  append(b: Uint8Array): void { for (const v of b) this.parts.push(v) }
}

function chunk(id: string, content: Uint8Array, children: Uint8Array = new Uint8Array()): Uint8Array {
  const w = new Writer()
  w.tag(id)
  w.u32(content.length)
  w.u32(children.length)
  w.append(content)
  w.append(children)
  return w.bytes()
}

/** MagicaVoxel .vox (version 150). Axes are remapped from Y-up to Z-up. */
export function exportVox(grid: VoxelGrid, layers: Layer[]): Uint8Array {
  const info = new LayerInfo(layers)
  const box = grid.bbox((l) => info.visible(l))
  if (!box) throw new Error('Nothing to export')
  const size: [number, number, number] = [
    box.max[0] - box.min[0] + 1, box.max[2] - box.min[2] + 1, box.max[1] - box.min[1] + 1,
  ]
  if (size.some((s) => s > 256)) throw new Error('VOX models are limited to 256 voxels per axis')

  const hist = new Map<number, number>()
  grid.forEach((_x, _y, _z, c, l) => { if (info.visible(l)) hist.set(c, (hist.get(c) ?? 0) + 1) })
  const reduce = quantizeColors(hist, 255)
  const palette: number[] = []
  const index = new Map<number, number>()
  for (const c of new Set(reduce.values())) {
    index.set(c, palette.length + 1)
    palette.push(c)
  }

  const voxels: number[] = []
  grid.forEach((x, y, z, c, l) => {
    if (!info.visible(l)) return
    voxels.push(x - box.min[0], box.max[2] - z, y - box.min[1], index.get(reduce.get(c)!)!)
  })

  const sizeChunk = new Writer()
  sizeChunk.u32(size[0]); sizeChunk.u32(size[1]); sizeChunk.u32(size[2])
  const xyzi = new Writer()
  xyzi.u32(voxels.length / 4)
  for (const v of voxels) xyzi.u8(v)
  const rgba = new Writer()
  for (let i = 0; i < 256; i++) {
    const c = i < palette.length ? palette[i] : 0
    const [r, g, b] = rgb(c)
    rgba.u8(r); rgba.u8(g); rgba.u8(b); rgba.u8(255)
  }

  const children = new Writer()
  children.append(chunk('SIZE', sizeChunk.bytes()))
  children.append(chunk('XYZI', xyzi.bytes()))
  children.append(chunk('RGBA', rgba.bytes()))
  const header = new Writer()
  header.tag('VOX ')
  header.u32(150)
  header.append(chunk('MAIN', new Uint8Array(), children.bytes()))
  return header.bytes()
}

export interface ImportedVox {
  size: [number, number, number]
  /** Voxels already mapped to Y-up with the min corner at the origin. */
  voxels: { x: number; y: number; z: number; color: number }[]
}

export function importVox(bytes: Uint8Array): ImportedVox {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3])
  if (tag(0) !== 'VOX ') throw new Error('Not a VOX file')

  let size: [number, number, number] | null = null
  let raw: number[] | null = null
  let palette: number[] | null = null

  const walk = (start: number, end: number) => {
    let o = start
    while (o + 12 <= end) {
      const id = tag(o)
      const contentSize = dv.getUint32(o + 4, true)
      const childSize = dv.getUint32(o + 8, true)
      const body = o + 12
      if (id === 'SIZE' && !size) {
        size = [dv.getUint32(body, true), dv.getUint32(body + 4, true), dv.getUint32(body + 8, true)]
      } else if (id === 'XYZI' && !raw) {
        const n = dv.getUint32(body, true)
        raw = []
        for (let i = 0; i < n; i++) {
          const p = body + 4 + i * 4
          raw.push(bytes[p], bytes[p + 1], bytes[p + 2], bytes[p + 3])
        }
      } else if (id === 'RGBA') {
        palette = []
        for (let i = 0; i < 256; i++) palette.push(fromRgb(bytes[body + i * 4], bytes[body + i * 4 + 1], bytes[body + i * 4 + 2]))
      }
      if (childSize > 0) walk(body + contentSize, body + contentSize + childSize)
      o = body + contentSize + childSize
    }
  }
  walk(8, bytes.length)
  if (!size || !raw) throw new Error('VOX file has no voxel data')
  const dims = size as [number, number, number]
  const pal = palette as number[] | null
  const voxels: ImportedVox['voxels'] = []
  const data = raw as number[]
  for (let i = 0; i < data.length; i += 4) {
    const idx = data[i + 3]
    const color = pal ? pal[idx - 1] : fromRgb(idx * 8 % 256, idx * 8 % 256, idx * 8 % 256)
    voxels.push({ x: data[i], y: data[i + 2], z: dims[1] - 1 - data[i + 1], color })
  }
  return { size: [dims[0], dims[2], dims[1]], voxels }
}
