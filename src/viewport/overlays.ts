import * as THREE from 'three'
import type { Symmetry, Vec3 } from '../core/types'
import { unpackX, unpackY, unpackZ } from '../core/voxelGrid'

const MAX_SHOWN = 60000
const unitBox = new THREE.BoxGeometry(1, 1, 1)

/** Translucent cubes drawn over a set of packed cells (falls back to a bounding box when huge). */
export class CellSet {
  readonly group = new THREE.Group()
  private mesh: THREE.InstancedMesh | null = null
  private capacity = 0
  private material: THREE.MeshBasicMaterial
  private m = new THREE.Matrix4()

  constructor(color: number, opacity: number, private scale = 1.03) {
    this.material = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1,
    })
    this.group.renderOrder = 5
  }

  setColor(color: number): void { this.material.color.setHex(color) }

  set(cells: number[]): void {
    if (cells.length === 0) {
      if (this.mesh) this.mesh.count = 0
      return
    }
    if (cells.length > MAX_SHOWN) {
      this.ensure(1)
      const lo = [Infinity, Infinity, Infinity]
      const hi = [-Infinity, -Infinity, -Infinity]
      for (const p of cells) {
        const c = [unpackX(p), unpackY(p), unpackZ(p)]
        for (let a = 0; a < 3; a++) {
          if (c[a] < lo[a]) lo[a] = c[a]
          if (c[a] > hi[a]) hi[a] = c[a]
        }
      }
      this.m.makeScale(hi[0] - lo[0] + 1, hi[1] - lo[1] + 1, hi[2] - lo[2] + 1)
      this.m.setPosition((lo[0] + hi[0] + 1) / 2, (lo[1] + hi[1] + 1) / 2, (lo[2] + hi[2] + 1) / 2)
      this.mesh!.setMatrixAt(0, this.m)
      this.mesh!.count = 1
      this.mesh!.instanceMatrix.needsUpdate = true
      return
    }
    this.ensure(cells.length)
    const mesh = this.mesh!
    for (let i = 0; i < cells.length; i++) {
      const p = cells[i]
      this.m.makeScale(this.scale, this.scale, this.scale)
      this.m.setPosition(unpackX(p) + 0.5, unpackY(p) + 0.5, unpackZ(p) + 0.5)
      mesh.setMatrixAt(i, this.m)
    }
    mesh.count = cells.length
    mesh.instanceMatrix.needsUpdate = true
  }

  private ensure(n: number): void {
    if (this.mesh && this.capacity >= n) return
    if (this.mesh) {
      this.group.remove(this.mesh)
      this.mesh.dispose()
    }
    this.capacity = Math.max(256, Math.min(MAX_SHOWN, n * 2))
    this.mesh = new THREE.InstancedMesh(unitBox, this.material, this.capacity)
    this.mesh.frustumCulled = false
    this.group.add(this.mesh)
  }
}

function lineSegments(positions: number[], color: string): THREE.LineSegments {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color }))
}

/** Floor grid, bounds box, axes and symmetry planes. */
export class SceneGuides {
  readonly group = new THREE.Group()
  private dynamic: THREE.Object3D[] = []

  update(opts: {
    bounds: Vec3; major: number; gridColor: string; showGrid: boolean; showBounds: boolean
    sym: Symmetry; showSymmetry: boolean
  }): void {
    for (const o of this.dynamic) {
      this.group.remove(o)
      o.traverse((c) => {
        const mesh = c as THREE.Mesh
        mesh.geometry?.dispose()
        ;(mesh.material as THREE.Material | undefined)?.dispose()
      })
    }
    this.dynamic = []
    const [bx, by, bz] = opts.bounds
    const add = (o: THREE.Object3D) => { this.group.add(o); this.dynamic.push(o) }

    if (opts.showGrid) {
      const minor: number[] = []
      const major: number[] = []
      for (let x = 0; x <= bx; x++) (x % opts.major === 0 ? major : minor).push(x, 0, 0, x, 0, bz)
      for (let z = 0; z <= bz; z++) (z % opts.major === 0 ? major : minor).push(0, 0, z, bx, 0, z)
      const minorLines = lineSegments(minor, opts.gridColor)
      ;(minorLines.material as THREE.LineBasicMaterial).transparent = true
      ;(minorLines.material as THREE.LineBasicMaterial).opacity = 0.45
      add(minorLines)
      add(lineSegments(major, opts.gridColor))
    }

    if (opts.showBounds) {
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(bx, by, bz)),
        new THREE.LineBasicMaterial({ color: opts.gridColor, transparent: true, opacity: 0.6 }),
      )
      edges.position.set(bx / 2, by / 2, bz / 2)
      add(edges)
    }

    const axes = new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute(
        'position',
        new THREE.Float32BufferAttribute([0, 0, 0, 8, 0, 0, 0, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0, 8], 3),
      ).setAttribute(
        'color',
        new THREE.Float32BufferAttribute([1, 0.3, 0.3, 1, 0.3, 0.3, 0.3, 1, 0.3, 0.3, 1, 0.3, 0.4, 0.5, 1, 0.4, 0.5, 1], 3),
      ),
      new THREE.LineBasicMaterial({ vertexColors: true }),
    )
    axes.position.set(-0.01, 0, -0.01)
    add(axes)

    const plane = (axis: 'x' | 'y' | 'z', color: number) => {
      const w = axis === 'x' ? bz : bx
      const h = axis === 'y' ? bz : by
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }),
      )
      if (axis === 'x') { mesh.rotation.y = Math.PI / 2; mesh.position.set(bx / 2, by / 2, bz / 2) }
      if (axis === 'y') { mesh.rotation.x = -Math.PI / 2; mesh.position.set(bx / 2, by / 2, bz / 2) }
      if (axis === 'z') mesh.position.set(bx / 2, by / 2, bz / 2)
      add(mesh)
    }
    if (opts.showSymmetry) {
      if (opts.sym.x) plane('x', 0xff5555)
      if (opts.sym.y) plane('y', 0x55ff55)
      if (opts.sym.z) plane('z', 0x5588ff)
    }
  }
}

export function makeGhostBox(color: number): THREE.LineSegments {
  const box = new THREE.LineSegments(
    new THREE.EdgesGeometry(unitBox),
    new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }),
  )
  box.renderOrder = 10
  box.visible = false
  return box
}
