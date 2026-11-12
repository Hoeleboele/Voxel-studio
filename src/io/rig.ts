import { LayerInfo } from '../core/layers'
import type { Layer, PartId, Vec3 } from '../core/types'
import type { VoxelGrid } from '../core/voxelGrid'

export interface RigBone {
  name: string
  parent: number // -1 for root
  head: Vec3 // grid coordinates
  /** Layer whose pose drives this bone (null for the root). */
  driver: number | null
}

export interface Rig {
  bones: RigBone[]
  layerBone: Map<number, number>
}

const BONE_PARENT: Partial<Record<PartId, PartId | 'root'>> = {
  torso: 'root', legL: 'root', legR: 'root', legFL: 'root', legFR: 'root', legBL: 'root', legBR: 'root',
  head: 'torso', armL: 'torso', armR: 'torso', tail: 'torso',
}

const BONE_ORDER: PartId[] = [
  'torso', 'head', 'armL', 'armR', 'legL', 'legR', 'legFL', 'legFR', 'legBL', 'legBR', 'tail',
]

/** Pivot used for a layer, matching the animation preview. */
export function layerPivot(grid: VoxelGrid, layer: Layer): Vec3 | null {
  if (layer.pivot) return layer.pivot
  const box = grid.bbox((l) => l === layer.id)
  if (!box) return null
  return [(box.min[0] + box.max[0] + 1) / 2, (box.min[1] + box.max[1] + 1) / 2, (box.min[2] + box.max[2] + 1) / 2]
}

/** Builds a simple skeleton from layers tagged with body parts. Returns null if there are too few parts. */
export function buildRig(grid: VoxelGrid, layers: Layer[]): Rig | null {
  const info = new LayerInfo(layers)
  const byPart = new Map<PartId, Layer>()
  for (const l of layers) {
    if (l.part && !l.isGroup && info.visible(l.id) && !byPart.has(l.part)) byPart.set(l.part, l)
  }
  const present = BONE_ORDER.filter((p) => byPart.has(p))
  if (present.length < 2) return null

  const torso = byPart.get('torso')
  const rootHead: Vec3 = (torso && layerPivot(grid, torso)) || [grid.bounds[0] / 2, 0, grid.bounds[2] / 2]
  const bones: RigBone[] = [{ name: 'root', parent: -1, head: rootHead, driver: null }]
  const boneIndex = new Map<string, number>([['root', 0]])

  for (const part of present) {
    const layer = byPart.get(part)!
    const wanted = BONE_PARENT[part] ?? 'root'
    const parent = boneIndex.get(wanted) ?? 0
    const head = layerPivot(grid, layer) ?? rootHead
    boneIndex.set(part, bones.length)
    bones.push({ name: part, parent, head, driver: layer.id })
  }

  const layerBone = new Map<number, number>()
  const fallback = boneIndex.get('torso') ?? 0
  for (const l of layers) {
    if (l.isGroup) continue
    let target = fallback
    if (l.part && boneIndex.has(l.part)) target = boneIndex.get(l.part)!
    else if (l.part === 'weapon') target = boneIndex.get('armR') ?? fallback
    layerBone.set(l.id, target)
  }
  return { bones, layerBone }
}
