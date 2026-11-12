import { describe, expect, it } from 'vitest'
import { EditBatch, applyAdd, applyErase, floodFill, forEachMirror, transformCells } from './edit'
import { history } from './history'
import { LayerInfo } from './layers'
import { boxCells, lineCells, sphereCells } from './shapes'
import { cellsBox, flipMapper, rotationMapper } from './transform'
import { quantizeColors } from './color'
import type { Layer } from './types'
import { VoxelGrid, packPos, unpackX, unpackY, unpackZ } from './voxelGrid'
import { deserializeVoxels, serializeVoxels } from './voxelIO'
import { exportVox, importVox } from '../io/vox'
import { exportStl, exportObjZip } from '../io/meshFormats'
import { buildExportMesh } from '../io/meshExport'
import { exportGltf } from '../io/gltf'
import { generateCharacter, DEFAULT_COLORS, DEFAULT_PROPORTIONS, requiredBounds } from '../templates/characters'
import { makeTemplateAnimation, samplePose } from '../anim/pose'
import { buildRig } from '../io/rig'
import { pickVoxel, planeCell } from '../viewport/picking'

const layer = (id: number, extra: Partial<Layer> = {}): Layer => ({
  id, name: `L${id}`, visible: true, locked: false, opacity: 1, parentId: null, isGroup: false, ...extra,
})

function makeCtx(grid: VoxelGrid, layers: Layer[] = [layer(1)], sym = { x: false, y: false, z: false }) {
  return { grid, info: new LayerInfo(layers), sym, color: 0xff0000, material: 0, layerId: 1 }
}

describe('VoxelGrid', () => {
  it('stores, reads and removes voxels across chunks', () => {
    const g = new VoxelGrid()
    g.set(3, 4, 5, 0x123456, 2, 1)
    g.set(40, 0, 17, 0xabcdef, 1, 0)
    expect(g.count).toBe(2)
    expect(g.getColor(3, 4, 5)).toBe(0x123456)
    expect(g.getLayer(3, 4, 5)).toBe(2)
    expect(g.getMaterial(3, 4, 5)).toBe(1)
    expect(g.getColor(0, 0, 0)).toBe(-1)
    expect(g.remove(3, 4, 5)).toBe(true)
    expect(g.remove(3, 4, 5)).toBe(false)
    expect(g.count).toBe(1)
  })

  it('treats black voxels as occupied', () => {
    const g = new VoxelGrid()
    g.set(1, 1, 1, 0x000000, 1, 0)
    expect(g.has(1, 1, 1)).toBe(true)
    expect(g.getColor(1, 1, 1)).toBe(0)
  })

  it('marks neighbouring chunks dirty on borders', () => {
    const g = new VoxelGrid()
    g.set(16, 5, 5, 1, 1, 0)
    expect(g.dirty.size).toBe(2)
  })

  it('round-trips through binary serialization', () => {
    const g = new VoxelGrid()
    g.set(1, 2, 3, 0x112233, 4, 2)
    g.set(200, 100, 50, 0xffffff, 1, 0)
    const copy = new VoxelGrid()
    deserializeVoxels(serializeVoxels(g), copy)
    expect(copy.count).toBe(2)
    expect(copy.getColor(200, 100, 50)).toBe(0xffffff)
    expect(copy.getLayer(1, 2, 3)).toBe(4)
    expect(copy.getMaterial(1, 2, 3)).toBe(2)
  })
})

describe('edit and history', () => {
  it('undoes and redoes a batch', () => {
    history.clear()
    const g = new VoxelGrid()
    const batch = new EditBatch(g)
    applyAdd(batch, makeCtx(g), (emit) => boxCells([0, 0, 0], [2, 2, 2], true, emit))
    batch.commit('Box')
    expect(g.count).toBe(27)
    history.undo()
    expect(g.count).toBe(0)
    history.redo()
    expect(g.count).toBe(27)
  })

  it('restores overwritten voxels on undo', () => {
    history.clear()
    const g = new VoxelGrid()
    g.set(1, 1, 1, 0x00ff00, 1, 0)
    const batch = new EditBatch(g)
    applyAdd(batch, makeCtx(g), (emit) => emit(1, 1, 1))
    batch.commit('Overwrite')
    expect(g.getColor(1, 1, 1)).toBe(0xff0000)
    history.undo()
    expect(g.getColor(1, 1, 1)).toBe(0x00ff00)
  })

  it('does not edit locked layers', () => {
    const g = new VoxelGrid()
    g.set(1, 1, 1, 0x00ff00, 2, 0)
    const layers = [layer(1), layer(2, { locked: true })]
    const batch = new EditBatch(g)
    applyErase(batch, makeCtx(g, layers), (emit) => emit(1, 1, 1))
    expect(g.has(1, 1, 1)).toBe(true)
    const blocked = new EditBatch(g)
    applyAdd(blocked, makeCtx(g, [layer(1, { locked: true })]), (emit) => emit(5, 5, 5))
    expect(g.has(5, 5, 5)).toBe(false)
  })

  it('respects grid bounds', () => {
    const g = new VoxelGrid()
    g.bounds = [4, 4, 4]
    const batch = new EditBatch(g)
    applyAdd(batch, makeCtx(g), (emit) => boxCells([2, 2, 2], [6, 6, 6], true, emit))
    expect(g.count).toBe(8)
  })

  it('mirrors edits across enabled axes', () => {
    const g = new VoxelGrid()
    g.bounds = [10, 10, 10]
    const seen: string[] = []
    forEachMirror(1, 2, 3, { x: true, y: false, z: true }, g.bounds, (x, y, z) => seen.push(`${x},${y},${z}`))
    expect(seen.sort()).toEqual(['1,2,3', '1,2,6', '8,2,3', '8,2,6'])
  })

  it('does not duplicate cells on the symmetry centre', () => {
    const seen: number[] = []
    forEachMirror(2, 0, 0, { x: true, y: false, z: false }, [5, 5, 5], (x) => seen.push(x))
    expect(seen).toEqual([2])
  })

  it('applies symmetric drawing in a single batch', () => {
    const g = new VoxelGrid()
    g.bounds = [8, 8, 8]
    const batch = new EditBatch(g)
    applyAdd(batch, makeCtx(g, [layer(1)], { x: true, y: false, z: false }), (emit) => emit(1, 0, 0))
    expect(g.has(1, 0, 0)).toBe(true)
    expect(g.has(6, 0, 0)).toBe(true)
  })
})

describe('shapes', () => {
  it('draws a connected line', () => {
    const cells: number[][] = []
    lineCells([0, 0, 0], [5, 3, 0], (x, y, z) => cells.push([x, y, z]))
    expect(cells.length).toBe(6)
    expect(cells[0]).toEqual([0, 0, 0])
    expect(cells[5]).toEqual([5, 3, 0])
  })

  it('makes hollow boxes with fewer cells', () => {
    let filled = 0, hollow = 0
    boxCells([0, 0, 0], [4, 4, 4], true, () => filled++)
    boxCells([0, 0, 0], [4, 4, 4], false, () => hollow++)
    expect(filled).toBe(125)
    expect(hollow).toBe(125 - 27)
  })

  it('makes symmetric spheres', () => {
    const set = new Set<string>()
    sphereCells([10, 10, 10], 3, true, (x, y, z) => set.add(`${x},${y},${z}`))
    expect(set.has('13,10,10')).toBe(true)
    expect(set.has('7,10,10')).toBe(true)
    expect(set.has('14,10,10')).toBe(false)
  })

  it('flood fills only the connected same-colour region', () => {
    const g = new VoxelGrid()
    for (let x = 0; x < 3; x++) g.set(x, 0, 0, 0xff0000, 1, 0)
    g.set(5, 0, 0, 0xff0000, 1, 0)
    g.set(1, 1, 0, 0x00ff00, 1, 0)
    const out: number[] = []
    floodFill(g, [0, 0, 0], null, (x, y, z) => out.push(packPos(x, y, z)))
    expect(out.length).toBe(3)
  })

  it('limits a plane fill to the clicked plane', () => {
    const g = new VoxelGrid()
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) g.set(x, y, 0, 0xff0000, 1, 0)
    const out: number[] = []
    floodFill(g, [1, 1, 0], 1, (x, y, z) => out.push(packPos(x, y, z)))
    expect(out.length).toBe(3)
  })
})

describe('transforms', () => {
  const cellsOf = (pts: [number, number, number][]) => pts.map((p) => packPos(...p))

  it('flips across the box centre', () => {
    const g = new VoxelGrid()
    g.set(1, 0, 0, 1, 1, 0)
    g.set(2, 0, 0, 2, 1, 0)
    const cells = cellsOf([[1, 0, 0], [2, 0, 0]])
    const batch = new EditBatch(g)
    transformCells(batch, new LayerInfo([layer(1)]), cells, flipMapper(cellsBox(cells)!, 0))
    expect(g.getColor(1, 0, 0)).toBe(2)
    expect(g.getColor(2, 0, 0)).toBe(1)
  })

  it('four rotations return to the start', () => {
    const pts: [number, number, number][] = [[2, 0, 0], [3, 0, 0], [3, 1, 0], [2, 2, 1]]
    const g = new VoxelGrid()
    pts.forEach((p, i) => g.set(p[0], p[1], p[2], i + 1, 1, 0))
    let cells = cellsOf(pts)
    for (let i = 0; i < 4; i++) {
      const batch = new EditBatch(g)
      cells = transformCells(batch, new LayerInfo([layer(1)]), cells, rotationMapper(cellsBox(cells)!, 1, 1))!
    }
    pts.forEach((p, i) => expect(g.getColor(p[0], p[1], p[2])).toBe(i + 1))
  })

  it('swaps dimensions when rotating', () => {
    const pts: [number, number, number][] = [[5, 0, 5], [6, 0, 5], [7, 0, 5]]
    const g = new VoxelGrid()
    pts.forEach((p) => g.set(p[0], p[1], p[2], 1, 1, 0))
    const cells = cellsOf(pts)
    const batch = new EditBatch(g)
    const moved = transformCells(batch, new LayerInfo([layer(1)]), cells, rotationMapper(cellsBox(cells)!, 1, 1))!
    const box = cellsBox(moved)!
    expect(box.max[0] - box.min[0]).toBe(0)
    expect(box.max[2] - box.min[2]).toBe(2)
    expect(moved.map((p) => [unpackX(p), unpackY(p), unpackZ(p)]).length).toBe(3)
  })

  it('refuses transforms that leave the grid', () => {
    const g = new VoxelGrid()
    g.bounds = [4, 4, 4]
    g.set(3, 0, 0, 1, 1, 0)
    const batch = new EditBatch(g)
    const r = transformCells(batch, new LayerInfo([layer(1)]), [packPos(3, 0, 0)], (x, y, z) => [x + 1, y, z])
    expect(r).toBeNull()
    expect(g.has(3, 0, 0)).toBe(true)
  })
})

describe('layers', () => {
  it('inherits visibility, lock and opacity from groups', () => {
    const layers = [
      layer(1, { isGroup: true, visible: false, opacity: 0.5 }),
      layer(2, { parentId: 1, opacity: 0.5 }),
      layer(3, { isGroup: true, locked: true }),
      layer(4, { parentId: 3 }),
    ]
    const info = new LayerInfo(layers)
    expect(info.visible(2)).toBe(false)
    expect(info.opacity(2)).toBeCloseTo(0.25)
    expect(info.locked(4)).toBe(true)
    expect(info.editable(4)).toBe(false)
  })
})

describe('color quantization', () => {
  it('keeps colors when under the limit', () => {
    const m = quantizeColors(new Map([[0xff0000, 3], [0x00ff00, 2]]), 4)
    expect(m.get(0xff0000)).toBe(0xff0000)
  })

  it('reduces to at most N colors and merges close colors', () => {
    const hist = new Map<number, number>()
    for (let i = 0; i < 40; i++) hist.set((i * 5 << 16) | 0x0000ff, 1)
    for (let i = 0; i < 40; i++) hist.set(0x00ff00 | (i * 3), 1)
    const m = quantizeColors(hist, 4)
    expect(new Set(m.values()).size).toBeLessThanOrEqual(4)
    expect(m.size).toBe(hist.size)
  })
})

describe('picking', () => {
  it('hits the first voxel and reports the face normal', () => {
    const g = new VoxelGrid()
    g.set(5, 5, 5, 1, 1, 0)
    const hit = pickVoxel(g, { origin: [5.5, 5.5, 20], dir: [0, 0, -1] }, () => true)!
    expect(hit.kind).toBe('voxel')
    expect(hit.cell).toEqual([5, 5, 5])
    expect(hit.normal).toEqual([0, 0, 1])
    expect(hit.place).toEqual([5, 5, 6])
  })

  it('falls back to the floor', () => {
    const g = new VoxelGrid()
    const hit = pickVoxel(g, { origin: [10.5, 20, 10.5], dir: [0, -1, 0] }, () => true)!
    expect(hit.kind).toBe('floor')
    expect(hit.place).toEqual([10, 0, 10])
  })

  it('skips voxels that are not pickable', () => {
    const g = new VoxelGrid()
    g.set(5, 0, 5, 1, 9, 0)
    const hit = pickVoxel(g, { origin: [5.5, 10, 5.5], dir: [0, -1, 0] }, (l) => l !== 9)!
    expect(hit.kind).toBe('floor')
  })

  it('projects onto a drag plane', () => {
    const g = new VoxelGrid()
    const cell = planeCell(g, { origin: [3.5, 10, 4.5], dir: [0, -1, 0] }, 1, 2)!
    expect(cell).toEqual([3, 2, 4])
  })
})

describe('exporters', () => {
  const layers = [layer(1)]
  const cube = () => {
    const g = new VoxelGrid()
    g.set(0, 0, 0, 0xff0000, 1, 0)
    g.set(1, 0, 0, 0x00ff00, 1, 0)
    return g
  }

  it('culls the shared face between neighbours', () => {
    const mesh = buildExportMesh(cube(), layers, { scope: 'all', scale: 1, center: false })
    expect(mesh.quadCount).toBe(10)
  })

  it('writes a binary STL with the right size', () => {
    const mesh = buildExportMesh(cube(), layers, { scope: 'all', scale: 1, center: false })
    expect(exportStl(mesh).length).toBe(84 + 20 * 50)
  })

  it('writes an OBJ zip', () => {
    const mesh = buildExportMesh(cube(), layers, { scope: 'all', scale: 1, center: false })
    expect(exportObjZip(mesh, 'm').length).toBeGreaterThan(100)
  })

  it('round-trips VOX', () => {
    const g = cube()
    g.set(1, 1, 1, 0x0000ff, 1, 0)
    const vox = importVox(exportVox(g, layers))
    expect(vox.voxels.length).toBe(3)
    expect(vox.size).toEqual([2, 2, 2])
    const colors = vox.voxels.map((v) => v.color).sort()
    expect(colors).toEqual([0x0000ff, 0x00ff00, 0xff0000].sort())
  })

  it('writes a valid GLB header', () => {
    const out = exportGltf(cube(), layers, { binary: true, scale: 1, center: true, rig: false, animations: [] })
    const data = out.data as Uint8Array
    const dv = new DataView(data.buffer)
    expect(dv.getUint32(0, true)).toBe(0x46546c67)
    expect(dv.getUint32(8, true)).toBe(data.length)
  })
})

describe('characters and animation', () => {
  it('generates every template within the grid with unique layer ids', () => {
    for (const kind of ['humanoid', 'animal', 'monster', 'robot'] as const) {
      const bounds = requiredBounds(kind, DEFAULT_PROPORTIONS[kind], [64, 64, 64])
      const gen = generateCharacter({ kind, proportions: DEFAULT_PROPORTIONS[kind], colors: DEFAULT_COLORS[kind] }, bounds)
      expect(gen.voxels.length).toBeGreaterThan(100)
      expect(new Set(gen.layers.map((l) => l.id)).size).toBe(gen.layers.length)
      for (const v of gen.voxels) {
        expect(v.x).toBeGreaterThanOrEqual(0)
        expect(v.x).toBeLessThan(gen.bounds[0])
        expect(gen.layers.some((l) => l.id === v.layerId)).toBe(true)
      }
    }
  })

  it('builds left/right limbs that mirror each other', () => {
    const bounds = requiredBounds('humanoid', DEFAULT_PROPORTIONS.humanoid, [64, 64, 64])
    const gen = generateCharacter({ kind: 'humanoid', proportions: DEFAULT_PROPORTIONS.humanoid, colors: DEFAULT_COLORS.humanoid }, bounds)
    const g = new VoxelGrid()
    g.bounds = gen.bounds
    for (const v of gen.voxels) g.set(v.x, v.y, v.z, v.color, v.layerId, v.material)
    const armL = gen.layers.find((l) => l.part === 'armL')!.id
    let mismatches = 0
    g.forEach((x, y, z, c, l) => {
      if (l !== armL) return
      if (g.getColor(gen.bounds[0] - 1 - x, y, z) !== c) mismatches++
    })
    expect(mismatches).toBe(0)
  })

  it('interpolates keyframes and wraps loops', () => {
    const anim = {
      id: 'a', name: 'a', fps: 8, length: 4, loop: true, snapshots: {},
      tracks: { 1: [{ frame: 0, pos: [0, 0, 0] as [number, number, number], rot: [0, 0, 0] as [number, number, number] }, { frame: 2, pos: [0, 0, 0] as [number, number, number], rot: [40, 0, 0] as [number, number, number] }] },
    }
    expect(samplePose(anim, 1, 1).rot[0]).toBeCloseTo(20)
    expect(samplePose(anim, 1, 3).rot[0]).toBeCloseTo(20)
  })

  it('creates template animations for tagged layers and a rig', () => {
    const bounds = requiredBounds('humanoid', DEFAULT_PROPORTIONS.humanoid, [64, 64, 64])
    const gen = generateCharacter({ kind: 'humanoid', proportions: DEFAULT_PROPORTIONS.humanoid, colors: DEFAULT_COLORS.humanoid }, bounds)
    for (const t of ['walk', 'idle', 'attack'] as const) {
      const anim = makeTemplateAnimation(t, gen.layers, t)
      expect(Object.keys(anim.tracks).length).toBeGreaterThanOrEqual(4)
    }
    const g = new VoxelGrid()
    g.bounds = gen.bounds
    for (const v of gen.voxels) g.set(v.x, v.y, v.z, v.color, v.layerId, v.material)
    const rig = buildRig(g, gen.layers)!
    expect(rig.bones[0].name).toBe('root')
    expect(rig.bones.length).toBe(7)
    const walk = makeTemplateAnimation('walk', gen.layers, 'w')
    const out = exportGltf(g, gen.layers, { binary: true, scale: 0.1, center: true, rig: true, animations: [walk] })
    expect(out.rigged).toBe(true)
  })
})
