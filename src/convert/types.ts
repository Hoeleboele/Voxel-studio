export interface RgbaImage {
  w: number
  h: number
  data: Uint8ClampedArray // RGBA, row-major, top row first
}

export interface SpriteTag { name: string; from: number; to: number }

/** Named source layer (Aseprite) used as a hint for armor/weapon/accessory detection. */
export interface LayerHint { name: string; mask: Uint8Array }

export interface SpriteSource {
  frames: RgbaImage[]
  durations: number[] // ms per frame
  tags: SpriteTag[]
  /** True when `frames` is a single unsliced sprite sheet that still needs frame detection. */
  needsSlicing: boolean
  layerHints?: LayerHint[]
}

export type DepthMode = 'relief' | 'shell' | 'solid' | 'symmetric'

export interface ConvertOptions {
  depth: number // maximum thickness in voxels
  mode: DepthMode
  shadingBias: number // 0..1, how much brightness pushes pixels forward
  smoothing: number // 0..3 box-blur passes on the depth map
  scale: number // voxels per source pixel (integer)
  detectLayers: boolean
  alphaThreshold: number
}

export const DEFAULT_CONVERT: ConvertOptions = {
  depth: 6,
  mode: 'symmetric',
  shadingBias: 0.35,
  smoothing: 1,
  scale: 1,
  detectLayers: true,
  alphaThreshold: 128,
}

export function newImage(w: number, h: number): RgbaImage {
  return { w, h, data: new Uint8ClampedArray(w * h * 4) }
}
