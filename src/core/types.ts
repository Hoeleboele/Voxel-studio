export type Vec3 = [number, number, number]

export const MATERIALS = ['solid', 'metal', 'glass', 'emissive'] as const
export type MaterialName = (typeof MATERIALS)[number]

export type PartId =
  | 'head' | 'torso' | 'armL' | 'armR' | 'legL' | 'legR'
  | 'legFL' | 'legFR' | 'legBL' | 'legBR' | 'tail' | 'weapon' | 'accessory'

export interface Voxel {
  x: number
  y: number
  z: number
  color: number // 0xRRGGBB
  layerId: number
  material: number // index into MATERIALS
}

export interface Layer {
  id: number
  name: string
  visible: boolean
  locked: boolean
  opacity: number
  parentId: number | null
  isGroup: boolean
  part?: PartId
  pivot?: Vec3 // continuous coordinates; voxel (x,y,z) spans [x,x+1]
}

export interface Palette {
  id: string
  name: string
  colors: number[]
  builtin?: boolean
}

export interface Keyframe {
  frame: number
  pos: Vec3
  rot: Vec3 // degrees, Euler XYZ around the layer pivot
}

export interface Animation {
  id: string
  name: string
  fps: number
  length: number
  loop: boolean
  tracks: Record<number, Keyframe[]>
  snapshots: Record<number, Uint8Array> // frame -> serialized voxels
}

export interface ProjectMeta {
  name: string
  author: string
  description: string
  created: number
  modified: number
}

export interface Symmetry {
  x: boolean
  y: boolean
  z: boolean
}
