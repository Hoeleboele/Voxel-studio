import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { clearHover, onPointerDown, onPointerMove, onPointerUp } from '../tools/toolController'
import type { Mods } from '../tools/toolController'
import { useEditor } from '../store/editorStore'
import type { ToolId } from '../store/editorStore'
import { getLayerInfo, grid, useProject } from '../store/projectStore'
import { useView } from '../store/viewStore'
import type { Vec3 } from '../core/types'
import { ChunkMeshManager } from './chunkMeshes'
import { CellSet, SceneGuides, makeGhostBox } from './overlays'

export type ViewName = 'front' | 'back' | 'left' | 'right' | 'top' | 'iso'

const ghostTools: ToolId[] = ['draw', 'erase', 'paint', 'fill', 'pick', 'line', 'box', 'sphere', 'select', 'move']

export class ViewportEngine {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera | THREE.OrthographicCamera
  private controls: OrbitControls
  private meshes = new ChunkMeshManager(grid)
  private guides = new SceneGuides()
  private ambient = new THREE.AmbientLight(0xffffff, 0.6)
  private sun = new THREE.DirectionalLight(0xffffff, 1)
  private ghost = makeGhostBox(0xffffff)
  private preview = new CellSet(0x4ade80, 0.5)
  private selection = new CellSet(0xfacc15, 0.35)
  private raycaster = new THREE.Raycaster()
  private raf = 0
  private needsRender = true
  private disposers: (() => void)[] = []
  private resizeObserver: ResizeObserver

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    container.appendChild(this.renderer.domElement)
    this.renderer.domElement.style.display = 'block'
    this.renderer.domElement.style.touchAction = 'none'

    this.scene.add(this.ambient, this.sun, this.meshes.group, this.guides.group, this.ghost)
    this.scene.add(this.preview.group, this.selection.group)

    const view = useView.getState()
    this.camera = this.createCamera(view.cameraMode, 1)
    const b = grid.bounds
    this.camera.position.set(b[0] * 1.1, b[1] * 0.9, b[2] * 1.6)
    this.controls = this.createControls()
    this.controls.target.set(b[0] / 2, b[1] / 4, b[2] / 2)
    this.applyViewSettings()
    this.rebuildGuides()
    this.attachPointer()
    this.attachSubscriptions()
    grid.markAllDirty()

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.resize()
    this.raf = requestAnimationFrame(this.loop)
  }

  private createCamera(mode: 'perspective' | 'orthographic', aspect: number, half = 40) {
    if (mode === 'orthographic') {
      const cam = new THREE.OrthographicCamera(-half * aspect, half * aspect, half, -half, -2000, 5000)
      return cam
    }
    return new THREE.PerspectiveCamera(50, aspect, 0.1, 5000)
  }

  private createControls(): OrbitControls {
    const c = new OrbitControls(this.camera, this.renderer.domElement)
    c.enableDamping = false
    c.screenSpacePanning = true
    c.zoomToCursor = true
    c.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE }
    c.minDistance = 2
    c.maxDistance = 1500
    c.addEventListener('change', () => { this.needsRender = true })
    return c
  }

  invalidate(): void { this.needsRender = true }

  private aspect(): number {
    const w = this.container.clientWidth || 1
    const h = this.container.clientHeight || 1
    return w / h
  }

  private resize(): void {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (w === 0 || h === 0) return
    this.renderer.setSize(w, h, false)
    this.renderer.domElement.style.width = '100%'
    this.renderer.domElement.style.height = '100%'
    const aspect = w / h
    if (this.camera instanceof THREE.PerspectiveCamera) {
      this.camera.aspect = aspect
    } else {
      this.camera.left = this.camera.bottom * aspect
      this.camera.right = this.camera.top * aspect
    }
    this.camera.updateProjectionMatrix()
    this.needsRender = true
  }

  setCameraMode(mode: 'perspective' | 'orthographic'): void {
    const isOrtho = this.camera instanceof THREE.OrthographicCamera
    if ((mode === 'orthographic') === isOrtho) return
    const target = this.controls.target.clone()
    const pos = this.camera.position.clone()
    const dist = pos.distanceTo(target)
    const half = Math.max(1, dist * Math.tan(THREE.MathUtils.degToRad(25)))
    this.controls.dispose()
    this.camera = this.createCamera(mode, this.aspect(), half)
    this.camera.position.copy(pos)
    this.camera.lookAt(target)
    this.controls = this.createControls()
    this.controls.target.copy(target)
    this.resize()
    this.controls.update()
  }

  setView(name: ViewName): void {
    const t = this.controls.target
    const dist = Math.max(10, this.camera.position.distanceTo(t))
    const dirs: Record<ViewName, Vec3> = {
      front: [0, 0, 1], back: [0, 0, -1], left: [1, 0, 0], right: [-1, 0, 0],
      top: [0, 1, 0.0001], iso: [1, 0.85, 1],
    }
    const d = new THREE.Vector3(...dirs[name]).normalize().multiplyScalar(dist)
    this.camera.position.copy(t).add(d)
    this.camera.lookAt(t)
    this.controls.update()
    this.needsRender = true
  }

  /** Centres the camera on the model (or the grid when empty). */
  frame(): void {
    const box = grid.bbox()
    const b = grid.bounds
    const min: Vec3 = box ? box.min : [0, 0, 0]
    const max: Vec3 = box ? [box.max[0] + 1, box.max[1] + 1, box.max[2] + 1] : [b[0], b[1] / 2, b[2]]
    const center = new THREE.Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2)
    const radius = Math.max(4, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2)
    const dir = this.camera.position.clone().sub(this.controls.target).normalize()
    if (this.camera instanceof THREE.PerspectiveCamera) {
      const dist = radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.2
      this.camera.position.copy(center).add(dir.multiplyScalar(dist))
    } else {
      this.camera.position.copy(center).add(dir.multiplyScalar(radius * 3))
      this.camera.top = radius * 1.2
      this.camera.bottom = -radius * 1.2
      this.camera.left = this.camera.bottom * this.aspect()
      this.camera.right = this.camera.top * this.aspect()
      this.camera.updateProjectionMatrix()
    }
    this.controls.target.copy(center)
    this.controls.update()
    this.needsRender = true
  }

  private applyViewSettings(): void {
    const v = useView.getState()
    this.scene.background = new THREE.Color(v.background)
    this.ambient.intensity = v.ambient * Math.PI
    this.sun.intensity = v.lightIntensity * Math.PI
    this.setCameraMode(v.cameraMode)
    this.needsRender = true
  }

  private rebuildGuides(): void {
    const v = useView.getState()
    this.guides.update({
      bounds: grid.bounds,
      major: Math.max(1, v.gridMajor),
      gridColor: v.gridColor,
      showGrid: v.showGrid,
      showBounds: v.showBounds,
      sym: useEditor.getState().sym,
      showSymmetry: v.showSymmetryPlanes,
    })
    this.needsRender = true
  }

  private updateSun(): void {
    const v = useView.getState()
    const az = THREE.MathUtils.degToRad(v.lightAzimuth)
    const el = THREE.MathUtils.degToRad(v.lightElevation)
    const d = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el))
    if (v.lightFollowsCamera) d.applyQuaternion(this.camera.quaternion)
    this.sun.position.copy(d.multiplyScalar(100))
  }

  private updateGhost(): void {
    const e = useEditor.getState()
    const h = e.hover
    if (!h || !ghostTools.includes(e.tool)) {
      this.ghost.visible = false
      this.needsRender = true
      return
    }
    const usePlace = (e.tool === 'draw' || ((e.tool === 'line' || e.tool === 'box' || e.tool === 'sphere') && e.shapeOp === 'add')) && h.place
    const cell = usePlace ? h.place! : h.cell
    const size = e.tool === 'draw' || e.tool === 'erase' || e.tool === 'paint' || e.tool === 'line' ? e.brush : 1
    const off = Math.floor((size - 1) / 2)
    this.ghost.scale.setScalar(size * 1.02)
    this.ghost.position.set(cell[0] - off + size / 2, cell[1] - off + size / 2, cell[2] - off + size / 2)
    this.ghost.visible = true
    this.needsRender = true
  }

  private attachSubscriptions(): void {
    this.disposers.push(
      useEditor.subscribe((s, prev) => {
        if (s.hover !== prev.hover || s.tool !== prev.tool || s.brush !== prev.brush) this.updateGhost()
        if (s.preview !== prev.preview) {
          if (s.preview) {
            this.preview.setColor(s.preview.mode === 'add' ? 0x4ade80 : s.preview.mode === 'erase' ? 0xef4444 : 0x60a5fa)
            this.preview.set(s.preview.cells)
          } else this.preview.set([])
          this.needsRender = true
        }
        if (s.selectionRev !== prev.selectionRev) {
          this.selection.set([...s.selection])
          this.needsRender = true
        }
        if (s.sym !== prev.sym) this.rebuildGuides()
      }),
      useView.subscribe((s, prev) => {
        if (s.cameraMode !== prev.cameraMode) this.setCameraMode(s.cameraMode)
        if (
          s.gridMajor !== prev.gridMajor || s.gridColor !== prev.gridColor || s.showGrid !== prev.showGrid ||
          s.showBounds !== prev.showBounds || s.showSymmetryPlanes !== prev.showSymmetryPlanes
        ) this.rebuildGuides()
        this.scene.background = new THREE.Color(s.background)
        this.ambient.intensity = s.ambient * Math.PI
        this.sun.intensity = s.lightIntensity * Math.PI
        this.needsRender = true
      }),
      useProject.subscribe((s, prev) => {
        if (s.bounds !== prev.bounds) this.rebuildGuides()
      }),
      grid.subscribe(() => { this.needsRender = true }),
    )
  }

  private mods(e: PointerEvent): Mods {
    return { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey }
  }

  private rayFrom(e: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -(((e.clientY - rect.top) / rect.height) * 2 - 1),
    )
    this.raycaster.setFromCamera(ndc, this.camera)
    const r = this.raycaster.ray
    return { origin: [r.origin.x, r.origin.y, r.origin.z] as Vec3, dir: [r.direction.x, r.direction.y, r.direction.z] as Vec3 }
  }

  private attachPointer(): void {
    const dom = this.renderer.domElement
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || e.altKey || e.pointerType === 'touch') return
      dom.setPointerCapture(e.pointerId)
      onPointerDown(this.rayFrom(e), this.mods(e))
    }
    const move = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return
      onPointerMove(this.rayFrom(e), this.mods(e))
    }
    const up = (e: PointerEvent) => {
      if (e.button !== 0) return
      onPointerUp()
    }
    const leave = () => clearHover()
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Alt') return
      this.controls.mouseButtons.LEFT = e.type === 'keydown' ? THREE.MOUSE.ROTATE : null
      if (e.type === 'keydown') e.preventDefault()
    }
    dom.addEventListener('pointerdown', down)
    dom.addEventListener('pointermove', move)
    dom.addEventListener('pointerup', up)
    dom.addEventListener('pointerleave', leave)
    window.addEventListener('keydown', key)
    window.addEventListener('keyup', key)
    this.disposers.push(() => {
      dom.removeEventListener('pointerdown', down)
      dom.removeEventListener('pointermove', move)
      dom.removeEventListener('pointerup', up)
      dom.removeEventListener('pointerleave', leave)
      window.removeEventListener('keydown', key)
      window.removeEventListener('keyup', key)
    })
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop)
    if (this.controls.update()) this.needsRender = true
    if (this.meshes.update(getLayerInfo(), 8)) this.needsRender = true
    if (!this.needsRender) return
    this.needsRender = false
    this.updateSun()
    this.renderer.render(this.scene, this.camera)
  }

  dispose(): void {
    cancelAnimationFrame(this.raf)
    this.resizeObserver.disconnect()
    for (const d of this.disposers) d()
    this.controls.dispose()
    this.meshes.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}

export let engine: ViewportEngine | null = null
export function setEngine(e: ViewportEngine | null): void { engine = e }
