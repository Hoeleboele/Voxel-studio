import type { Vec3 } from './types'

export type Emit = (x: number, y: number, z: number) => void

export function lineCells(a: Vec3, b: Vec3, emit: Emit): void {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2]
  const n = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz))
  if (n === 0) {
    emit(a[0], a[1], a[2])
    return
  }
  for (let i = 0; i <= n; i++) {
    const t = i / n
    emit(Math.round(a[0] + dx * t), Math.round(a[1] + dy * t), Math.round(a[2] + dz * t))
  }
}

export function boxCells(a: Vec3, b: Vec3, filled: boolean, emit: Emit): void {
  const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0])
  const y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1])
  const z0 = Math.min(a[2], b[2]), z1 = Math.max(a[2], b[2])
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        if (!filled && x > x0 && x < x1 && y > y0 && y < y1 && z > z0 && z < z1) continue
        emit(x, y, z)
      }
    }
  }
}

export function sphereCells(c: Vec3, r: number, filled: boolean, emit: Emit): void {
  const outer = (r + 0.5) * (r + 0.5)
  const inner = (r - 0.5) * (r - 0.5)
  for (let dx = -r; dx <= r; dx++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dz = -r; dz <= r; dz++) {
        const d2 = dx * dx + dy * dy + dz * dz
        if (d2 > outer) continue
        if (!filled && d2 <= inner) continue
        emit(c[0] + dx, c[1] + dy, c[2] + dz)
      }
    }
  }
}

export function ellipsoidCells(c: Vec3, r: Vec3, emit: Emit): void {
  const [rx, ry, rz] = r
  for (let dx = -Math.ceil(rx); dx <= Math.ceil(rx); dx++) {
    for (let dy = -Math.ceil(ry); dy <= Math.ceil(ry); dy++) {
      for (let dz = -Math.ceil(rz); dz <= Math.ceil(rz); dz++) {
        const v = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) + (dz * dz) / (rz * rz)
        if (v <= 1) emit(c[0] + dx, c[1] + dy, c[2] + dz)
      }
    }
  }
}

export function brushCells(center: Vec3, size: number, emit: Emit): void {
  const off = Math.floor((size - 1) / 2)
  for (let dx = 0; dx < size; dx++) {
    for (let dy = 0; dy < size; dy++) {
      for (let dz = 0; dz < size; dz++) {
        emit(center[0] - off + dx, center[1] - off + dy, center[2] - off + dz)
      }
    }
  }
}
