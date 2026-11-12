import type { Layer } from './types'

export class LayerInfo {
  private vis: Uint8Array
  private lock: Uint8Array
  private opa: Float32Array

  constructor(layers: Layer[]) {
    let max = 0
    for (const l of layers) if (l.id > max) max = l.id
    this.vis = new Uint8Array(max + 1).fill(1)
    this.lock = new Uint8Array(max + 1)
    this.opa = new Float32Array(max + 1).fill(1)
    const byId = new Map(layers.map((l) => [l.id, l]))
    for (const l of layers) {
      let visible = true
      let locked = false
      let opacity = 1
      let cur: Layer | undefined = l
      let guard = 0
      while (cur && guard++ < 32) {
        if (!cur.visible) visible = false
        if (cur.locked) locked = true
        opacity *= cur.opacity
        cur = cur.parentId === null ? undefined : byId.get(cur.parentId)
      }
      this.vis[l.id] = visible ? 1 : 0
      this.lock[l.id] = locked ? 1 : 0
      this.opa[l.id] = opacity
    }
  }

  visible(id: number): boolean { return id < this.vis.length ? this.vis[id] === 1 : true }
  locked(id: number): boolean { return id < this.lock.length ? this.lock[id] === 1 : false }
  opacity(id: number): number { return id < this.opa.length ? this.opa[id] : 1 }
  editable(id: number): boolean { return this.visible(id) && !this.locked(id) }
}

export function childrenOf(layers: Layer[], id: number | null): Layer[] {
  return layers.filter((l) => l.parentId === id)
}

export function descendantIds(layers: Layer[], id: number): number[] {
  const out: number[] = []
  const walk = (pid: number) => {
    for (const l of layers) {
      if (l.parentId === pid) {
        out.push(l.id)
        walk(l.id)
      }
    }
  }
  walk(id)
  return out
}

export function cloneLayers(layers: Layer[]): Layer[] {
  return layers.map((l) => ({ ...l, pivot: l.pivot ? [...l.pivot] : undefined }))
}

/** Layers ordered as a depth-first tree with their nesting depth. */
export function layerTree(layers: Layer[]): { layer: Layer; depth: number }[] {
  const out: { layer: Layer; depth: number }[] = []
  const ids = new Set(layers.map((l) => l.id))
  const walk = (pid: number | null, depth: number) => {
    for (const l of layers) {
      const parent = l.parentId !== null && ids.has(l.parentId) ? l.parentId : null
      if (parent === pid) {
        out.push({ layer: l, depth })
        walk(l.id, depth + 1)
      }
    }
  }
  walk(null, 0)
  return out
}
