import { LayerInfo } from '../core/layers'
import type { Layer, PartId, Species, Vec3 } from '../core/types'
import type { VoxelGrid } from '../core/voxelGrid'
import { layerPivot } from '../io/rig'

export interface Metrics {
  height: number
  width: number
  depth: number
  legLength: number
  armLength: number
  headSize: number
  bulk: number // 0..1, share of voxels in the torso
  parts: Set<PartId>
  hasWeapon: boolean
  armored: boolean
  metal: number // share of metal voxels
  feet: Vec3 // centre of the lowest point
  hips: Vec3
}

const bboxOf = (grid: VoxelGrid, ids: Set<number>) => (ids.size ? grid.bbox((l) => ids.has(l)) : null)

export function measureCharacter(grid: VoxelGrid, layers: Layer[]): Metrics {
  const info = new LayerInfo(layers)
  const parted = layers.filter((l) => l.part && !l.isGroup && info.visible(l.id))
  const ids = (pred: (p: PartId) => boolean) => new Set(parted.filter((l) => pred(l.part!)).map((l) => l.id))
  const all = new Set(parted.map((l) => l.id))
  const box = bboxOf(grid, all) ?? grid.bbox() ?? { min: [0, 0, 0] as Vec3, max: [1, 1, 1] as Vec3 }
  const dim = (b: { min: Vec3; max: Vec3 } | null, axis: number) => (b ? b.max[axis] - b.min[axis] + 1 : 0)

  const legs = bboxOf(grid, ids((p) => p.startsWith('leg')))
  const arms = bboxOf(grid, ids((p) => p.startsWith('arm')))
  const head = bboxOf(grid, ids((p) => p === 'head'))
  const height = dim(box, 1)
  const torsoLayer = parted.find((l) => l.part === 'torso')

  let total = 0, torso = 0, metal = 0
  const torsoIds = new Set(parted.filter((l) => l.part === 'torso').map((l) => l.id))
  grid.forEach((_x, _y, _z, _c, l, m) => {
    total++
    if (torsoIds.has(l)) torso++
    if (m === 1) metal++
  })

  const cx = (box.min[0] + box.max[0] + 1) / 2
  const cz = (box.min[2] + box.max[2] + 1) / 2
  const legLength = legs ? dim(legs, 1) : height * 0.35
  const feet: Vec3 = [cx, box.min[1], cz]
  const hips = (torsoLayer && layerPivot(grid, torsoLayer)) || [cx, box.min[1] + legLength, cz]
  return {
    height, width: dim(box, 0), depth: dim(box, 2), legLength,
    armLength: arms ? dim(arms, 1) : height * 0.35,
    headSize: head ? dim(head, 1) : height * 0.25,
    bulk: total ? torso / total : 0.3,
    parts: new Set(parted.map((l) => l.part!)),
    hasWeapon: parted.some((l) => l.part === 'weapon'),
    armored: parted.some((l) => /armor|armour|plate|mail/i.test(l.name)),
    metal: total ? metal / total : 0,
    feet, hips: hips as Vec3,
  }
}

export function detectSpecies(m: Metrics, layers: Layer[]): Species {
  const names = layers.map((l) => l.name).join(' ')
  if (m.parts.has('wingL') || m.parts.has('wingR')) return 'winged'
  if (/robot|mech|droid|\bbot\b/i.test(names) || m.metal > 0.35) return 'robot'
  const quad = ['legFL', 'legFR', 'legBL', 'legBR'].filter((p) => m.parts.has(p as PartId)).length
  if (quad >= 2) return 'quadruped'
  if (!m.parts.has('legL') && !m.parts.has('legR') && !m.parts.has('armL') && !m.parts.has('armR')) return 'blob'
  return 'biped'
}

export const SPECIES_LABEL: Record<Species, string> = {
  biped: 'Biped', quadruped: 'Quadruped', robot: 'Robot', winged: 'Winged (dragon)', blob: 'Blob / other',
}

/** Motion tuning per character; amplitudes are in degrees, bob in voxels. */
export interface Profile {
  stride: number
  armSwing: number
  bob: number
  sway: number
  twist: number
  lean: number
  breath: number
  tail: number
  wing: number
  stiff: number // 0..1 how mechanical the motion feels
  weight: number // 1 = average; heavier moves slower and lands harder
  walkFps: number
  idleFps: number
}

const BASE: Record<Species, Omit<Profile, 'weight' | 'walkFps' | 'idleFps'>> = {
  biped: { stride: 32, armSwing: 26, bob: 0.6, sway: 3, twist: 5, lean: 4, breath: 0.5, tail: 12, wing: 0, stiff: 0 },
  quadruped: { stride: 24, armSwing: 0, bob: 0.35, sway: 2, twist: 3, lean: 0, breath: 0.4, tail: 16, wing: 0, stiff: 0 },
  robot: { stride: 22, armSwing: 14, bob: 0.15, sway: 0, twist: 0, lean: 0, breath: 0, tail: 6, wing: 0, stiff: 1 },
  winged: { stride: 22, armSwing: 14, bob: 0.4, sway: 3, twist: 3, lean: 3, breath: 0.6, tail: 18, wing: 28, stiff: 0 },
  blob: { stride: 0, armSwing: 0, bob: 1.2, sway: 4, twist: 0, lean: 0, breath: 0.8, tail: 0, wing: 0, stiff: 0 },
}

export function profileFor(species: Species, m: Metrics): Profile {
  const base = BASE[species]
  const size = Math.max(0.6, Math.min(1.6, m.height / 32))
  const weight = Math.max(0.6, Math.min(1.8, 0.8 + m.bulk * 1.2 + (m.armored ? 0.3 : 0) + (m.hasWeapon ? 0.05 : 0) + (species === 'robot' ? 0.2 : 0)))
  // Longest swing that keeps a foot travelling less than ~60% of the leg length.
  const strideCap = (Math.asin(0.6) * 180) / Math.PI
  return {
    ...base,
    stride: Math.min(strideCap, base.stride * (1.1 - 0.3 * (weight - 1))),
    armSwing: base.armSwing / Math.max(0.8, weight),
    bob: base.bob * size / weight,
    breath: base.breath * size,
    weight,
    walkFps: Math.max(5, Math.min(12, Math.round(10 - m.legLength / 6 + (1 - weight) * 2))),
    idleFps: species === 'robot' ? 6 : 8,
  }
}
