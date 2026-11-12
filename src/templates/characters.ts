import type { Layer, PartId, Vec3 } from '../core/types'
import { packPos } from '../core/voxelGrid'

export type CharacterKind = 'humanoid' | 'animal' | 'monster' | 'robot' | 'blank'

export interface Proportions {
  head: number
  torsoH: number
  torsoW: number
  torsoD: number
  armLen: number
  armT: number
  legLen: number
  legT: number
}

export interface ColorScheme {
  skin: number
  primary: number
  secondary: number
  accent: number
  dark: number
  eye: number
  hair: number
}

export interface CharacterSpec {
  kind: CharacterKind
  proportions: Proportions
  colors: ColorScheme
}

export interface GeneratedVoxel { x: number; y: number; z: number; color: number; layerId: number; material: number }

export interface GeneratedCharacter {
  layers: Layer[]
  voxels: GeneratedVoxel[]
  bounds: Vec3
}

export const DEFAULT_PROPORTIONS: Record<CharacterKind, Proportions> = {
  humanoid: { head: 8, torsoH: 10, torsoW: 8, torsoD: 5, armLen: 10, armT: 3, legLen: 11, legT: 3 },
  animal: { head: 8, torsoH: 8, torsoW: 6, torsoD: 14, armLen: 8, armT: 2, legLen: 6, legT: 2 },
  monster: { head: 12, torsoH: 12, torsoW: 16, torsoD: 10, armLen: 14, armT: 4, legLen: 6, legT: 5 },
  robot: { head: 8, torsoH: 10, torsoW: 10, torsoD: 6, armLen: 11, armT: 3, legLen: 10, legT: 4 },
  blank: { head: 8, torsoH: 10, torsoW: 8, torsoD: 5, armLen: 10, armT: 3, legLen: 11, legT: 3 },
}

export const PROPORTION_LABELS: Record<CharacterKind, Record<keyof Proportions, string>> = {
  humanoid: { head: 'Head size', torsoH: 'Torso height', torsoW: 'Torso width', torsoD: 'Torso depth', armLen: 'Arm length', armT: 'Arm thickness', legLen: 'Leg length', legT: 'Leg thickness' },
  animal: { head: 'Head size', torsoH: 'Body height', torsoW: 'Body width', torsoD: 'Body length', armLen: 'Tail length', armT: 'Ear size', legLen: 'Leg length', legT: 'Leg thickness' },
  monster: { head: 'Head size', torsoH: 'Torso height', torsoW: 'Torso width', torsoD: 'Torso depth', armLen: 'Arm length', armT: 'Arm thickness', legLen: 'Leg length', legT: 'Leg thickness' },
  robot: { head: 'Head size', torsoH: 'Torso height', torsoW: 'Torso width', torsoD: 'Torso depth', armLen: 'Arm length', armT: 'Arm thickness', legLen: 'Leg length', legT: 'Leg thickness' },
  blank: { head: 'Head size', torsoH: 'Torso height', torsoW: 'Torso width', torsoD: 'Torso depth', armLen: 'Arm length', armT: 'Arm thickness', legLen: 'Leg length', legT: 'Leg thickness' },
}

export const PROPORTION_LIMITS: Record<keyof Proportions, [number, number]> = {
  head: [4, 20], torsoH: [4, 28], torsoW: [4, 28], torsoD: [2, 28],
  armLen: [2, 28], armT: [1, 8], legLen: [2, 28], legT: [1, 8],
}

export const DEFAULT_COLORS: Record<CharacterKind, ColorScheme> = {
  humanoid: { skin: 0xf2c9a0, primary: 0x3b5dc9, secondary: 0x333c57, accent: 0xffcd75, dark: 0x1a1c2c, eye: 0x1a1c2c, hair: 0x6b4a31 },
  animal: { skin: 0xef7d57, primary: 0xef7d57, secondary: 0xf4f4f4, accent: 0x1a1c2c, dark: 0x1a1c2c, eye: 0x38b764, hair: 0xb13e53 },
  monster: { skin: 0x38b764, primary: 0x38b764, secondary: 0x257179, accent: 0xf4f4f4, dark: 0x5d275d, eye: 0xffcd75, hair: 0xb13e53 },
  robot: { skin: 0x94b0c2, primary: 0x94b0c2, secondary: 0x566c86, accent: 0xef7d57, dark: 0x333c57, eye: 0x73eff7, hair: 0x333c57 },
  blank: { skin: 0xf2c9a0, primary: 0x3b5dc9, secondary: 0x333c57, accent: 0xffcd75, dark: 0x1a1c2c, eye: 0x1a1c2c, hair: 0x6b4a31 },
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)

class Builder {
  voxels = new Map<number, GeneratedVoxel>()
  layers: Layer[] = []
  private nextId = 1
  private byLayer = new Map<number, number[]>()

  constructor(readonly bx: number, readonly by: number, readonly bz: number) {}

  get cx(): number { return this.bx / 2 }
  get cz(): number { return this.bz / 2 }

  group(name: string): number {
    const id = this.nextId++
    this.layers.push({ id, name, visible: true, locked: false, opacity: 1, parentId: null, isGroup: true })
    return id
  }

  layer(name: string, part: PartId | undefined, parentId: number | null, pivot?: Vec3): number {
    const id = this.nextId++
    this.layers.push({
      id, name, visible: true, locked: false, opacity: 1, parentId, isGroup: false, part,
      pivot: pivot ? [this.cx + pivot[0], pivot[1], this.cz + pivot[2]] : undefined,
    })
    this.byLayer.set(id, [])
    return id
  }

  /** Local x is centred on the grid midline, local z is centred on the grid depth. */
  put(layer: number, lx: number, y: number, lz: number, color: number, material = 0): void {
    const x = this.cx + lx, z = this.cz + lz
    if (x < 0 || y < 0 || z < 0 || x >= this.bx || y >= this.by || z >= this.bz) return
    const key = packPos(x, y, z)
    this.voxels.set(key, { x, y, z, color, layerId: layer, material })
    this.byLayer.get(layer)?.push(key)
  }

  box(layer: number, x0: number, y0: number, z0: number, w: number, h: number, d: number, color: number, mat = 0): void {
    for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) for (let z = 0; z < d; z++) {
      this.put(layer, x0 + x, y0 + y, z0 + z, color, mat)
    }
  }

  ellipsoid(layer: number, ex: number, ey: number, ez: number, rx: number, ry: number, rz: number, color: number, mat = 0): void {
    for (let x = Math.floor(ex - rx); x <= Math.ceil(ex + rx); x++) {
      for (let y = Math.floor(ey - ry); y <= Math.ceil(ey + ry); y++) {
        for (let z = Math.floor(ez - rz); z <= Math.ceil(ez + rz); z++) {
          const dx = (x + 0.5 - ex) / rx, dy = (y + 0.5 - ey) / ry, dz = (z + 0.5 - ez) / rz
          if (dx * dx + dy * dy + dz * dz <= 1) this.put(layer, x, y, z, color, mat)
        }
      }
    }
  }

  /** Puts a voxel and its mirror image across the midline. */
  putM(layer: number, lx: number, y: number, lz: number, color: number, mat = 0): void {
    this.put(layer, lx, y, lz, color, mat)
    this.put(layer, -1 - lx, y, lz, color, mat)
  }

  /** Copies every voxel of `src` mirrored across the midline into `dst`. */
  mirrorTo(src: number, dst: number): void {
    for (const key of this.byLayer.get(src) ?? []) {
      const v = this.voxels.get(key)
      if (!v || v.layerId !== src) continue
      this.put(dst, this.bx - 1 - v.x - this.cx, v.y, v.z - this.cz, v.color, v.material)
    }
  }

  result(): GeneratedCharacter {
    return { layers: this.layers, voxels: [...this.voxels.values()], bounds: [this.bx, this.by, this.bz] }
  }
}

function humanoid(b: Builder, P: Proportions, C: ColorScheme, metal = 0): void {
  const hw = Math.ceil(P.torsoW / 2)
  const td = P.torsoD
  const zf = Math.floor(td / 2)
  const legT = Math.min(P.legT, hw)
  const H = even(P.head)
  const torsoTop = P.legLen + P.torsoH
  const body = b.group('Body')
  const limbs = b.group('Limbs')

  const legZ0 = -Math.floor(legT / 2)
  const legX0 = hw - legT
  const legL = b.layer('Leg L', 'legL', limbs, [legX0 + legT / 2, P.legLen, 0])
  const legR = b.layer('Leg R', 'legR', limbs, [-(legX0 + legT / 2), P.legLen, 0])
  b.box(legL, legX0, 0, legZ0, legT, P.legLen, legT, C.secondary, metal)
  b.box(legL, legX0, 0, legZ0, legT, Math.min(2, P.legLen), legT, C.dark)
  b.box(legL, legX0, 0, legZ0 + legT, legT, 1, 1, C.dark)
  b.mirrorTo(legL, legR)

  const torso = b.layer('Torso', 'torso', body, [0, P.legLen, 0])
  b.box(torso, -hw, P.legLen, -zf, 2 * hw, P.torsoH, td, C.primary, metal)
  b.box(torso, -hw, P.legLen, -zf, 2 * hw, 1, td, C.dark)
  b.box(torso, -1, P.legLen, td - zf - 1, 2, 1, 1, C.accent)

  const armZ0 = -Math.floor(P.armT / 2)
  const armL = b.layer('Arm L', 'armL', limbs, [hw + P.armT / 2, torsoTop - 1, 0])
  const armR = b.layer('Arm R', 'armR', limbs, [-(hw + P.armT / 2), torsoTop - 1, 0])
  const armY = Math.max(0, torsoTop - P.armLen)
  b.box(armL, hw, armY, armZ0, P.armT, torsoTop - armY, P.armT, C.primary, metal)
  b.box(armL, hw, armY, armZ0, P.armT, Math.min(2, torsoTop - armY), P.armT, C.skin)
  b.mirrorTo(armL, armR)

  const head = b.layer('Head', 'head', body, [0, torsoTop, 0])
  b.box(head, -H / 2, torsoTop, -H / 2, H, H, H, C.skin)
  b.box(head, -H / 2, torsoTop + H - 2, -H / 2, H, 2, H, C.hair)
  b.box(head, -H / 2, torsoTop + 2, -H / 2, H, H - 4, 1, C.hair)
  b.box(head, -H / 2, torsoTop + H - 3, H / 2 - 1, H, 1, 1, C.hair)
  const fz = H / 2 - 1
  b.putM(head, Math.max(1, Math.floor(H / 4)), torsoTop + Math.floor(H / 2) - 1, fz, C.eye, metal ? 3 : 0)
  b.box(head, -1, torsoTop + Math.floor(H / 4), fz, 2, 1, 1, 0xb13e53)
}

function animal(b: Builder, P: Proportions, C: ColorScheme): void {
  const hw = Math.ceil(P.torsoW / 2)
  const bl = P.torsoD
  const zb0 = -Math.floor(bl / 2)
  const zf = zb0 + bl - 1
  const legT = Math.min(P.legT, hw)
  const H = even(P.head)
  const top = P.legLen + P.torsoH
  const body = b.group('Body')
  const limbs = b.group('Legs')

  const torso = b.layer('Body', 'torso', body, [0, top - 1, 0])
  b.box(torso, -hw, P.legLen, zb0, 2 * hw, P.torsoH, bl, C.primary)
  b.box(torso, -hw, P.legLen, zb0, 2 * hw, 1, bl, C.secondary)
  b.box(torso, -1, top - 1, zb0, 2, 1, bl, C.hair)

  const mkLeg = (name: string, part: PartId, z0: number) => {
    const left = b.layer(`${name} L`, part, limbs, [hw - legT / 2, P.legLen, z0 + legT / 2])
    b.box(left, hw - legT, 0, z0, legT, P.legLen, legT, C.primary)
    b.box(left, hw - legT, 0, z0, legT, 1, legT, C.accent)
    return left
  }
  const flL = mkLeg('Front leg', 'legFL', zf - legT + 1)
  const flR = b.layer('Front leg R', 'legFR', limbs, [-(hw - legT / 2), P.legLen, zf - legT / 2 + 0.5])
  b.mirrorTo(flL, flR)
  const blL = mkLeg('Back leg', 'legBL', zb0)
  const blR = b.layer('Back leg R', 'legBR', limbs, [-(hw - legT / 2), P.legLen, zb0 + legT / 2])
  b.mirrorTo(blL, blR)

  const head = b.layer('Head', 'head', body, [0, top - 2, zf])
  const hy = top - Math.round(H * 0.7)
  b.box(head, -H / 2, hy, zf, H, H, H, C.primary)
  const sw = even(H / 2)
  b.box(head, -sw / 2, hy, zf + H, sw, Math.max(2, Math.round(H / 3)), Math.max(2, Math.round(H / 3)), C.secondary)
  b.box(head, -1, hy + Math.max(2, Math.round(H / 3)) - 1, zf + H + Math.max(2, Math.round(H / 3)) - 1, 2, 1, 1, C.accent)
  b.putM(head, Math.floor(H / 4), hy + Math.round(H * 0.6), zf + H - 1, C.eye)
  const ear = Math.max(1, P.armT)
  b.box(head, H / 2 - 2, hy + H, zf + 1, 2, ear, 2, C.primary)
  b.box(head, -H / 2, hy + H, zf + 1, 2, ear, 2, C.primary)

  const tail = b.layer('Tail', 'tail', body, [0, top - 1, zb0])
  for (let i = 0; i < P.armLen; i++) {
    b.box(tail, -1, top - 2 + Math.floor(i / 2), zb0 - 1 - i, 2, 2, 1, i >= P.armLen - 2 ? C.secondary : C.primary)
  }
}

function monster(b: Builder, P: Proportions, C: ColorScheme): void {
  const hw = Math.ceil(P.torsoW / 2)
  const td = P.torsoD
  const H = even(P.head)
  const torsoTop = P.legLen + P.torsoH
  const body = b.group('Body')
  const limbs = b.group('Limbs')

  const legT = Math.min(P.legT, hw)
  const legX0 = Math.max(0, hw - legT - 1)
  const legL = b.layer('Leg L', 'legL', limbs, [legX0 + legT / 2, P.legLen, 0])
  const legR = b.layer('Leg R', 'legR', limbs, [-(legX0 + legT / 2), P.legLen, 0])
  b.box(legL, legX0, 0, -Math.floor(legT / 2), legT, P.legLen, legT, C.secondary)
  b.box(legL, legX0, 0, Math.ceil(legT / 2), legT, 1, 2, C.accent)
  b.mirrorTo(legL, legR)

  const torso = b.layer('Torso', 'torso', body, [0, P.legLen, 0])
  b.ellipsoid(torso, 0, P.legLen + P.torsoH / 2, 0, hw, P.torsoH / 2, td / 2, C.primary)
  b.ellipsoid(torso, 0, P.legLen + P.torsoH / 2 - 1, td / 4, hw * 0.65, P.torsoH * 0.38, td / 2, C.secondary)

  const armT = Math.min(P.armT, 6)
  const armY = Math.max(1, torsoTop - P.armLen)
  const armL = b.layer('Arm L', 'armL', limbs, [hw + armT / 2 - 1, torsoTop - 2, 0])
  const armR = b.layer('Arm R', 'armR', limbs, [-(hw + armT / 2 - 1), torsoTop - 2, 0])
  b.box(armL, hw - 1, armY, -Math.floor(armT / 2), armT, torsoTop - 1 - armY, armT, C.primary)
  b.box(armL, hw - 1, armY, -Math.floor(armT / 2), armT, 2, armT, C.secondary)
  for (let i = 0; i < armT; i += 2) b.box(armL, hw - 1 + i, Math.max(0, armY - 1), Math.floor(armT / 2), 1, 2, 1, C.accent)
  b.mirrorTo(armL, armR)

  const head = b.layer('Head', 'head', body, [0, torsoTop - 2, 0])
  const hy = torsoTop - 2
  b.ellipsoid(head, 0, hy + H / 2, 1, H / 2 + 1, H / 2, H / 2, C.primary)
  b.putM(head, Math.floor(H / 4), hy + Math.round(H * 0.6), Math.floor(H / 2), C.eye)
  b.putM(head, Math.floor(H / 4), hy + Math.round(H * 0.6), Math.floor(H / 2) + 1, C.dark)
  b.box(head, -Math.floor(H / 3), hy + Math.round(H * 0.25), Math.floor(H / 2), 2 * Math.floor(H / 3), 1, 1, C.dark)
  for (let x = -Math.floor(H / 3) + 1; x < Math.floor(H / 3); x += 2) b.put(head, x, hy + Math.round(H * 0.25) + 1, Math.floor(H / 2), C.accent)

  const horns = b.layer('Horns', 'accessory', body, [0, hy + H, 0])
  for (let i = 0; i < 4; i++) {
    const x = Math.floor(H / 3) + i
    b.putM(horns, x, hy + H - 1 + i, 1, C.accent)
    b.putM(horns, x, hy + H - 1 + i + 1, 1, C.accent)
  }
}

function robot(b: Builder, P: Proportions, C: ColorScheme): void {
  const hw = Math.ceil(P.torsoW / 2)
  const td = P.torsoD
  const zf = Math.floor(td / 2)
  const legT = Math.min(P.legT, hw)
  const H = even(P.head)
  const torsoTop = P.legLen + P.torsoH
  const body = b.group('Body')
  const limbs = b.group('Limbs')
  const M = 1

  const legX0 = hw - legT
  const legL = b.layer('Leg L', 'legL', limbs, [legX0 + legT / 2, P.legLen, 0])
  const legR = b.layer('Leg R', 'legR', limbs, [-(legX0 + legT / 2), P.legLen, 0])
  const z0 = -Math.floor(legT / 2)
  b.box(legL, legX0, 0, z0, legT, P.legLen, legT, C.primary, M)
  b.box(legL, legX0, Math.floor(P.legLen / 2), z0, legT, 1, legT, C.dark, M)
  b.box(legL, legX0 - 1, 0, z0, legT + 1, 2, legT + 2, C.secondary, M)
  b.mirrorTo(legL, legR)

  const torso = b.layer('Torso', 'torso', body, [0, P.legLen, 0])
  b.box(torso, -hw, P.legLen, -zf, 2 * hw, P.torsoH, td, C.primary, M)
  b.box(torso, -hw, P.legLen, -zf, 2 * hw, 1, td, C.dark, M)
  b.box(torso, -2, P.legLen + Math.floor(P.torsoH / 2), td - zf - 1, 4, 3, 1, C.accent, 3)
  for (let i = 0; i < 3; i++) b.box(torso, -hw + 1, P.legLen + 2 + i * 2, td - zf - 1, 2, 1, 1, C.dark)
  b.box(torso, -2, torsoTop, -2, 4, 1, 4, C.dark, M)

  const armZ0 = -Math.floor(P.armT / 2)
  const armL = b.layer('Arm L', 'armL', limbs, [hw + P.armT / 2, torsoTop - 1, 0])
  const armR = b.layer('Arm R', 'armR', limbs, [-(hw + P.armT / 2), torsoTop - 1, 0])
  const armY = Math.max(0, torsoTop - P.armLen)
  b.box(armL, hw, armY, armZ0, P.armT, torsoTop - armY, P.armT, C.secondary, M)
  b.box(armL, hw, armY + Math.floor((torsoTop - armY) / 2), armZ0, P.armT, 1, P.armT, C.dark, M)
  b.box(armL, hw, armY, armZ0, P.armT, 2, P.armT, C.dark, M)
  b.mirrorTo(armL, armR)

  const head = b.layer('Head', 'head', body, [0, torsoTop + 1, 0])
  const hy = torsoTop + 1
  b.box(head, -H / 2, hy, -H / 2, H, H, H, C.primary, M)
  b.box(head, -H / 2 + 1, hy + Math.floor(H / 2) - 1, H / 2 - 1, H - 2, 2, 1, C.eye, 3)
  b.box(head, -H / 2 - 1, hy + 2, -1, 1, 3, 2, C.dark, M)
  b.box(head, H / 2, hy + 2, -1, 1, 3, 2, C.dark, M)
  const ant = b.layer('Antenna', 'accessory', body, [0, hy + H, 0])
  b.box(ant, -1, hy + H, 0, 2, 3, 1, C.dark, M)
  b.box(ant, -1, hy + H + 3, 0, 2, 1, 1, C.accent, 3)
}

export function requiredBounds(kind: CharacterKind, P: Proportions, current: Vec3): Vec3 {
  const w = even(Math.max(current[0], P.torsoW + 2 * P.armT + P.head + 4))
  const h = Math.max(current[1], P.legLen + P.torsoH + P.head + 8)
  const d = even(Math.max(current[2], P.torsoD + P.head + P.armLen + 10))
  return kind === 'blank' ? current : [Math.min(256, w), Math.min(256, h), Math.min(256, d)]
}

export function generateCharacter(spec: CharacterSpec, bounds: Vec3): GeneratedCharacter {
  const bx = even(bounds[0]), bz = even(bounds[2])
  const b = new Builder(bx, bounds[1], bz)
  const P = spec.proportions
  const C = spec.colors
  switch (spec.kind) {
    case 'humanoid': humanoid(b, P, C); break
    case 'animal': animal(b, P, C); break
    case 'monster': monster(b, P, C); break
    case 'robot': robot(b, P, C); break
    case 'blank':
      b.layer('Layer 1', undefined, null)
      break
  }
  return b.result()
}
