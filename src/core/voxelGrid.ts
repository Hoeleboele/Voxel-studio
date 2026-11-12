import type { Vec3 } from './types'

export const CHUNK = 16
const CS = CHUNK * CHUNK * CHUNK
const OCC = 0x1000000 // set on stored colors so 0 always means empty

export function packPos(x: number, y: number, z: number): number {
  return x | (y << 8) | (z << 16)
}
export function unpackX(p: number): number { return p & 255 }
export function unpackY(p: number): number { return (p >> 8) & 255 }
export function unpackZ(p: number): number { return (p >> 16) & 255 }

export class Chunk {
  colors = new Uint32Array(CS)
  layers = new Uint16Array(CS)
  mats = new Uint8Array(CS)
  count = 0
  constructor(public cx: number, public cy: number, public cz: number) {}
}

export function chunkKey(cx: number, cy: number, cz: number): number {
  return ((cx + 512) * 1024 + (cy + 512)) * 1024 + (cz + 512)
}

export function localIndex(x: number, y: number, z: number): number {
  return (x & 15) | ((y & 15) << 4) | ((z & 15) << 8)
}

export class VoxelGrid {
  chunks = new Map<number, Chunk>()
  dirty = new Set<number>()
  count = 0
  revision = 0
  bounds: Vec3 = [64, 64, 64]
  private listeners = new Set<() => void>()

  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.bounds[0] && y < this.bounds[1] && z < this.bounds[2]
  }

  chunkAt(x: number, y: number, z: number): Chunk | undefined {
    return this.chunks.get(chunkKey(x >> 4, y >> 4, z >> 4))
  }

  /** Stored value: 0 when empty, otherwise rgb | OCC. */
  getRaw(x: number, y: number, z: number): number {
    const c = this.chunkAt(x, y, z)
    return c ? c.colors[localIndex(x, y, z)] : 0
  }

  has(x: number, y: number, z: number): boolean {
    return this.getRaw(x, y, z) !== 0
  }

  /** RGB color, or -1 when empty. */
  getColor(x: number, y: number, z: number): number {
    const raw = this.getRaw(x, y, z)
    return raw === 0 ? -1 : raw & 0xffffff
  }

  getLayer(x: number, y: number, z: number): number {
    const c = this.chunkAt(x, y, z)
    return c ? c.layers[localIndex(x, y, z)] : 0
  }

  getMaterial(x: number, y: number, z: number): number {
    const c = this.chunkAt(x, y, z)
    return c ? c.mats[localIndex(x, y, z)] : 0
  }

  set(x: number, y: number, z: number, color: number, layer: number, material: number): void {
    this.setRaw(x, y, z, (color & 0xffffff) | OCC, layer, material)
  }

  setRaw(x: number, y: number, z: number, raw: number, layer: number, material: number): void {
    if (raw === 0) {
      this.remove(x, y, z)
      return
    }
    const key = chunkKey(x >> 4, y >> 4, z >> 4)
    let chunk = this.chunks.get(key)
    if (!chunk) {
      chunk = new Chunk(x >> 4, y >> 4, z >> 4)
      this.chunks.set(key, chunk)
    }
    const i = localIndex(x, y, z)
    if (chunk.colors[i] === 0) {
      chunk.count++
      this.count++
    }
    chunk.colors[i] = raw
    chunk.layers[i] = layer
    chunk.mats[i] = material
    this.markDirty(x, y, z)
  }

  remove(x: number, y: number, z: number): boolean {
    const key = chunkKey(x >> 4, y >> 4, z >> 4)
    const chunk = this.chunks.get(key)
    if (!chunk) return false
    const i = localIndex(x, y, z)
    if (chunk.colors[i] === 0) return false
    chunk.colors[i] = 0
    chunk.layers[i] = 0
    chunk.mats[i] = 0
    chunk.count--
    this.count--
    if (chunk.count === 0) this.chunks.delete(key)
    this.markDirty(x, y, z)
    return true
  }

  private markDirty(x: number, y: number, z: number): void {
    const cx = x >> 4, cy = y >> 4, cz = z >> 4
    this.dirty.add(chunkKey(cx, cy, cz))
    // Neighbour chunks need a rebuild because face culling crosses borders.
    const lx = x & 15, ly = y & 15, lz = z & 15
    if (lx === 0) this.dirty.add(chunkKey(cx - 1, cy, cz))
    if (lx === 15) this.dirty.add(chunkKey(cx + 1, cy, cz))
    if (ly === 0) this.dirty.add(chunkKey(cx, cy - 1, cz))
    if (ly === 15) this.dirty.add(chunkKey(cx, cy + 1, cz))
    if (lz === 0) this.dirty.add(chunkKey(cx, cy, cz - 1))
    if (lz === 15) this.dirty.add(chunkKey(cx, cy, cz + 1))
  }

  markAllDirty(): void {
    for (const key of this.chunks.keys()) this.dirty.add(key)
  }

  clear(): void {
    for (const key of this.chunks.keys()) this.dirty.add(key)
    this.chunks.clear()
    this.count = 0
  }

  forEach(cb: (x: number, y: number, z: number, color: number, layer: number, mat: number) => void): void {
    for (const chunk of this.chunks.values()) {
      const ox = chunk.cx << 4, oy = chunk.cy << 4, oz = chunk.cz << 4
      const { colors, layers, mats } = chunk
      for (let i = 0; i < colors.length; i++) {
        const raw = colors[i]
        if (raw === 0) continue
        cb(ox + (i & 15), oy + ((i >> 4) & 15), oz + (i >> 8), raw & 0xffffff, layers[i], mats[i])
      }
    }
  }

  bbox(filter?: (layer: number) => boolean): { min: Vec3; max: Vec3 } | null {
    let any = false
    const min: Vec3 = [Infinity, Infinity, Infinity]
    const max: Vec3 = [-Infinity, -Infinity, -Infinity]
    this.forEach((x, y, z, _c, l) => {
      if (filter && !filter(l)) return
      any = true
      if (x < min[0]) min[0] = x
      if (y < min[1]) min[1] = y
      if (z < min[2]) min[2] = z
      if (x > max[0]) max[0] = x
      if (y > max[1]) max[1] = y
      if (z > max[2]) max[2] = z
    })
    return any ? { min, max } : null
  }

  touch(): void {
    this.revision++
    for (const fn of this.listeners) fn()
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
}

export const RAW_OCC = OCC
