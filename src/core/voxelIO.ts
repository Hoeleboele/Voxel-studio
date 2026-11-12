import type { VoxelGrid } from './voxelGrid'
import { VoxelGrid as Grid } from './voxelGrid'

const REC = 10

/** Binary layout per voxel: x,y,z,material (u8), layer (u16), rgb (u32). */
export function serializeVoxels(grid: VoxelGrid): Uint8Array {
  const out = new Uint8Array(4 + grid.count * REC)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, grid.count, true)
  let o = 4
  grid.forEach((x, y, z, color, layer, mat) => {
    dv.setUint8(o, x)
    dv.setUint8(o + 1, y)
    dv.setUint8(o + 2, z)
    dv.setUint8(o + 3, mat)
    dv.setUint16(o + 4, layer, true)
    dv.setUint32(o + 6, color, true)
    o += REC
  })
  return out
}

export function deserializeVoxels(bytes: Uint8Array, target: VoxelGrid): void {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = dv.getUint32(0, true)
  let o = 4
  for (let i = 0; i < count; i++) {
    target.set(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint32(o + 6, true), dv.getUint16(o + 4, true), dv.getUint8(o + 3))
    o += REC
  }
}

export function gridFromBytes(bytes: Uint8Array, bounds: [number, number, number]): VoxelGrid {
  const g = new Grid()
  g.bounds = bounds
  deserializeVoxels(bytes, g)
  return g
}
