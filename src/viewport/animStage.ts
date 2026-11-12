import * as THREE from 'three'
import { samplePose } from '../anim/pose'
import { LayerInfo } from '../core/layers'
import type { Animation, Layer, Vec3 } from '../core/types'
import { gridFromBytes } from '../core/voxelIO'
import type { VoxelGrid } from '../core/voxelGrid'
import { GeoBuilder, visitFaces } from './mesher'

interface Holder { holder: THREE.Group; pivot: Vec3 }

interface Built {
  group: THREE.Group
  holders: Map<number, Holder>
  disposables: { dispose(): void }[]
}

function buildLayers(grid: VoxelGrid, layers: Layer[], flat: boolean): Built {
  const info = new LayerInfo(layers)
  const opaqueMat = flat ? new THREE.MeshBasicMaterial({ vertexColors: true }) : new THREE.MeshLambertMaterial({ vertexColors: true })
  const transMat = flat
    ? new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false })
    : new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, depthWrite: false })
  const disposables: { dispose(): void }[] = [opaqueMat, transMat]

  const builders = new Map<number, { o: GeoBuilder; t: GeoBuilder }>()
  const boxes = new Map<number, { min: Vec3; max: Vec3 }>()
  grid.forEach((x, y, z, _c, l) => {
    let b = boxes.get(l)
    if (!b) { b = { min: [x, y, z], max: [x, y, z] }; boxes.set(l, b) }
    if (x < b.min[0]) b.min[0] = x
    if (y < b.min[1]) b.min[1] = y
    if (z < b.min[2]) b.min[2] = z
    if (x > b.max[0]) b.max[0] = x
    if (y > b.max[1]) b.max[1] = y
    if (z > b.max[2]) b.max[2] = z
  })

  visitFaces(grid, null, { info, scope: 'layer' }, (x, y, z, f, color, layer, mat, alpha) => {
    let b = builders.get(layer)
    if (!b) { b = { o: new GeoBuilder(false), t: new GeoBuilder(true) }; builders.set(layer, b) }
    if (alpha >= 1) b.o.addFace(x, y, z, f, color, mat, 1)
    else b.t.addFace(x, y, z, f, color, mat, alpha)
  })

  const group = new THREE.Group()
  const holders = new Map<number, Holder>()
  const layerById = new Map(layers.map((l) => [l.id, l]))
  for (const [id, b] of builders) {
    const box = boxes.get(id)!
    const pivot: Vec3 = layerById.get(id)?.pivot ?? [
      (box.min[0] + box.max[0] + 1) / 2, (box.min[1] + box.max[1] + 1) / 2, (box.min[2] + box.max[2] + 1) / 2,
    ]
    const holder = new THREE.Group()
    holder.position.set(...pivot)
    for (const [builder, mat, order] of [[b.o, opaqueMat, 0], [b.t, transMat, 1]] as const) {
      if (builder.empty) continue
      const geo = builder.toGeometry()
      disposables.push(geo)
      const mesh = new THREE.Mesh(geo, mat)
      mesh.renderOrder = order
      mesh.position.set(-pivot[0], -pivot[1], -pivot[2])
      mesh.frustumCulled = false
      holder.add(mesh)
    }
    group.add(holder)
    holders.set(id, { holder, pivot })
  }
  return { group, holders, disposables }
}

/** Renders the model as one rigid group per layer so layers can be posed independently. */
export class AnimStage {
  readonly root = new THREE.Group()
  private base: Built
  private snapshots = new Map<number, Built>()
  private shown: Built

  constructor(
    private grid: VoxelGrid, private layers: Layer[], private flat = false,
  ) {
    this.base = buildLayers(grid, layers, flat)
    this.shown = this.base
    this.root.add(this.base.group)
  }

  /** `snap` rounds positions to whole voxels so sprites stay pixel aligned. */
  setFrame(anim: Animation | null, frame: number, snap = false): void {
    const snapBytes = anim?.snapshots[frame]
    if (anim && snapBytes) {
      let built = this.snapshots.get(frame)
      if (!built) {
        built = buildLayers(gridFromBytes(snapBytes, this.grid.bounds), this.layers, this.flat)
        this.snapshots.set(frame, built)
        this.root.add(built.group)
      }
      this.show(built)
      return
    }
    this.show(this.base)
    for (const [id, h] of this.base.holders) {
      const pose = anim ? samplePose(anim, id, frame) : null
      const p = pose?.pos ?? [0, 0, 0]
      const r = pose?.rot ?? [0, 0, 0]
      const px = snap ? Math.round(p[0]) : p[0]
      const py = snap ? Math.round(p[1]) : p[1]
      const pz = snap ? Math.round(p[2]) : p[2]
      h.holder.position.set(h.pivot[0] + px, h.pivot[1] + py, h.pivot[2] + pz)
      h.holder.rotation.set(THREE.MathUtils.degToRad(r[0]), THREE.MathUtils.degToRad(r[1]), THREE.MathUtils.degToRad(r[2]), 'XYZ')
    }
  }

  private show(built: Built): void {
    if (this.shown === built) return
    this.shown.group.visible = false
    built.group.visible = true
    this.shown = built
  }

  dispose(): void {
    for (const b of [this.base, ...this.snapshots.values()]) for (const d of b.disposables) d.dispose()
    this.snapshots.clear()
  }
}
