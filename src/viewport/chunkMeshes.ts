import * as THREE from 'three'
import type { VoxelGrid } from '../core/voxelGrid'
import type { LayerInfo } from '../core/layers'
import { buildChunkGeometry } from './mesher'

interface Entry { opaque?: THREE.Mesh; trans?: THREE.Mesh }

/** Keeps one pair of meshes per dirty chunk, rebuilding only what changed. */
export class ChunkMeshManager {
  readonly group = new THREE.Group()
  private entries = new Map<number, Entry>()
  private opaqueMat = new THREE.MeshLambertMaterial({ vertexColors: true })
  private transMat = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, depthWrite: false })

  constructor(private grid: VoxelGrid) {}

  /** Rebuilds dirty chunks within the time budget; returns true when anything changed. */
  update(info: LayerInfo, budgetMs = 10): boolean {
    if (this.grid.dirty.size === 0) return false
    const start = performance.now()
    for (const key of this.grid.dirty) {
      this.grid.dirty.delete(key)
      this.rebuild(key, info)
      if (performance.now() - start > budgetMs) break
    }
    return true
  }

  get pending(): boolean { return this.grid.dirty.size > 0 }

  private rebuild(key: number, info: LayerInfo): void {
    const old = this.entries.get(key)
    if (old) {
      this.drop(old.opaque)
      this.drop(old.trans)
      this.entries.delete(key)
    }
    const chunk = this.grid.chunks.get(key)
    if (!chunk) return
    const geo = buildChunkGeometry(this.grid, chunk, info)
    const entry: Entry = {}
    if (geo.opaque) {
      entry.opaque = new THREE.Mesh(geo.opaque, this.opaqueMat)
      this.group.add(entry.opaque)
    }
    if (geo.trans) {
      entry.trans = new THREE.Mesh(geo.trans, this.transMat)
      entry.trans.renderOrder = 1
      this.group.add(entry.trans)
    }
    this.entries.set(key, entry)
  }

  private drop(mesh?: THREE.Mesh): void {
    if (!mesh) return
    this.group.remove(mesh)
    mesh.geometry.dispose()
  }

  dispose(): void {
    for (const e of this.entries.values()) {
      this.drop(e.opaque)
      this.drop(e.trans)
    }
    this.entries.clear()
    this.opaqueMat.dispose()
    this.transMat.dispose()
  }
}
