import * as THREE from 'three'
import { GIFEncoder, applyPalette, quantize } from 'gifenc'
import { LayerInfo } from '../core/layers'
import type { Animation, Layer, Vec3 } from '../core/types'
import type { VoxelGrid } from '../core/voxelGrid'
import { AnimStage } from '../viewport/animStage'

export type ViewId = 'front' | 'side' | 'back' | 'iso1' | 'iso2' | 'iso3' | 'iso4'

export const VIEW_LABELS: Record<ViewId, string> = {
  front: 'Front', side: 'Side', back: 'Back', iso1: 'Iso 1', iso2: 'Iso 2', iso3: 'Iso 3', iso4: 'Iso 4',
}

/** Direction from the model towards the camera. */
const VIEW_DIRS: Record<ViewId, Vec3> = {
  front: [0, 0, 1],
  side: [-1, 0, 0],
  back: [0, 0, -1],
  iso1: [1, 1, 1],
  iso2: [-1, 1, 1],
  iso3: [-1, 1, -1],
  iso4: [1, 1, -1],
}

export interface SpriteOptions {
  views: ViewId[]
  scale: number
  shaded: boolean
  padding: number
  animation: Animation | null
  /** CSS color, or null for a transparent background. */
  background: string | null
}

const MAX_SIZE = 8192

interface Layout {
  cellW: number
  cellH: number
  center: Vec3
  frames: number
}

function layoutFor(grid: VoxelGrid, layers: Layer[], opts: SpriteOptions): Layout {
  const info = new LayerInfo(layers)
  const box = grid.bbox((l) => info.visible(l))
  if (!box) throw new Error('Nothing to render')
  const pad = opts.animation ? Math.max(opts.padding, 4) : opts.padding
  const lo: Vec3 = [box.min[0] - pad, box.min[1] - pad, box.min[2] - pad]
  const hi: Vec3 = [box.max[0] + 1 + pad, box.max[1] + 1 + pad, box.max[2] + 1 + pad]
  const center: Vec3 = [
    Math.round((lo[0] + hi[0]) / 2), Math.round((lo[1] + hi[1]) / 2), Math.round((lo[2] + hi[2]) / 2),
  ]
  let halfW = 0
  let halfH = 0
  for (const view of opts.views) {
    const d = new THREE.Vector3(...VIEW_DIRS[view]).normalize()
    const right = new THREE.Vector3(0, 1, 0).cross(d).normalize()
    const up = d.clone().cross(right).normalize()
    for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) {
      const p = new THREE.Vector3(x - center[0], y - center[1], z - center[2])
      halfW = Math.max(halfW, Math.abs(p.dot(right)))
      halfH = Math.max(halfH, Math.abs(p.dot(up)))
    }
  }
  const even = (n: number) => Math.ceil(n / 2) * 2
  return {
    cellW: even(halfW * 2 * opts.scale),
    cellH: even(halfH * 2 * opts.scale),
    center,
    frames: opts.animation ? opts.animation.length : 1,
  }
}

function makeScene(stage: AnimStage, shaded: boolean): THREE.Scene {
  const scene = new THREE.Scene()
  scene.add(stage.root)
  if (shaded) {
    scene.add(new THREE.AmbientLight(0xffffff, 0.5 * Math.PI))
    const sun = new THREE.DirectionalLight(0xffffff, 0.6 * Math.PI)
    sun.position.set(0.4, 0.9, 0.7).multiplyScalar(100)
    scene.add(sun)
  }
  return scene
}

function makeRenderer(w: number, h: number, background: string | null): THREE.WebGLRenderer {
  const r = new THREE.WebGLRenderer({ antialias: false, alpha: true, preserveDrawingBuffer: true })
  r.setPixelRatio(1)
  r.setSize(w, h, false)
  r.setClearColor(background ?? 0x000000, background ? 1 : 0)
  r.autoClear = false
  r.setScissorTest(true)
  return r
}

function cameraFor(view: ViewId, layout: Layout, scale: number): THREE.OrthographicCamera {
  const hw = layout.cellW / (2 * scale)
  const hh = layout.cellH / (2 * scale)
  const cam = new THREE.OrthographicCamera(-hw, hw, hh, -hh, -2000, 2000)
  const dir = new THREE.Vector3(...VIEW_DIRS[view]).normalize()
  const center = new THREE.Vector3(...layout.center)
  cam.position.copy(center).add(dir.multiplyScalar(500))
  cam.lookAt(center)
  cam.updateMatrixWorld()
  return cam
}

function renderCell(
  r: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.Camera, x: number, y: number, w: number, h: number,
): void {
  r.setViewport(x, y, w, h)
  r.setScissor(x, y, w, h)
  r.clear()
  r.render(scene, cam)
}

export function renderSpriteSheet(grid: VoxelGrid, layers: Layer[], opts: SpriteOptions): HTMLCanvasElement {
  if (opts.views.length === 0) throw new Error('Choose at least one view')
  const layout = layoutFor(grid, layers, opts)
  const totalW = layout.cellW * opts.views.length
  const totalH = layout.cellH * layout.frames
  if (totalW > MAX_SIZE || totalH > MAX_SIZE) throw new Error('Sprite sheet is too large; lower the scale or pick fewer views')

  const stage = new AnimStage(grid, layers, !opts.shaded)
  const scene = makeScene(stage, opts.shaded)
  const renderer = makeRenderer(totalW, totalH, opts.background)
  const cams = opts.views.map((v) => cameraFor(v, layout, opts.scale))

  for (let f = 0; f < layout.frames; f++) {
    stage.setFrame(opts.animation, f, true)
    cams.forEach((cam, col) => {
      renderCell(renderer, scene, cam, col * layout.cellW, totalH - (f + 1) * layout.cellH, layout.cellW, layout.cellH)
    })
  }

  const out = document.createElement('canvas')
  out.width = totalW
  out.height = totalH
  out.getContext('2d')!.drawImage(renderer.domElement, 0, 0)
  stage.dispose()
  renderer.dispose()
  return out
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png')
  })
}

export function renderGif(grid: VoxelGrid, layers: Layer[], opts: SpriteOptions & { view: ViewId }): Uint8Array {
  const anim = opts.animation
  if (!anim) throw new Error('Select an animation to export a GIF')
  const o = { ...opts, views: [opts.view] }
  const layout = layoutFor(grid, layers, o)
  const stage = new AnimStage(grid, layers, !opts.shaded)
  const scene = makeScene(stage, opts.shaded)
  const renderer = makeRenderer(layout.cellW, layout.cellH, opts.background)
  const cam = cameraFor(opts.view, layout, opts.scale)

  const scratch = document.createElement('canvas')
  scratch.width = layout.cellW
  scratch.height = layout.cellH
  const ctx = scratch.getContext('2d', { willReadFrequently: true })!
  const gif = GIFEncoder()
  const transparent = opts.background === null

  for (let f = 0; f < anim.length; f++) {
    stage.setFrame(anim, f, true)
    renderCell(renderer, scene, cam, 0, 0, layout.cellW, layout.cellH)
    ctx.clearRect(0, 0, layout.cellW, layout.cellH)
    ctx.drawImage(renderer.domElement, 0, 0)
    const rgba = ctx.getImageData(0, 0, layout.cellW, layout.cellH).data
    const format = transparent ? 'rgba4444' : 'rgb565'
    const palette = quantize(rgba, 256, transparent ? { format, oneBitAlpha: true } : { format })
    const index = applyPalette(rgba, palette, format)
    const transparentIndex = transparent ? palette.findIndex((p) => p.length > 3 && p[3] === 0) : -1
    gif.writeFrame(index, layout.cellW, layout.cellH, {
      palette,
      delay: Math.round(1000 / anim.fps),
      repeat: anim.loop ? 0 : -1,
      transparent: transparentIndex >= 0,
      transparentIndex: Math.max(0, transparentIndex),
      dispose: 2,
    })
  }
  gif.finish()
  stage.dispose()
  renderer.dispose()
  return gif.bytes()
}
