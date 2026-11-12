import { useEffect, useMemo, useState } from 'react'
import { ASSET_CATEGORIES, BUILTIN_ASSETS, makeAsset, thumbnail, useAssets } from '../assets/assets'
import type { Asset, AssetCategory } from '../assets/assets'
import { cellsBox } from '../core/transform'
import { unpackX, unpackY, unpackZ } from '../core/voxelGrid'
import { placeVoxels } from '../tools/actions'
import { regenerateCharacter } from '../tools/projectOps'
import { useEditor } from '../store/editorStore'
import { grid, uid, useProject } from '../store/projectStore'
import { DEFAULT_COLORS, DEFAULT_PROPORTIONS } from '../templates/characters'
import { Btn, Row, Section } from './common'

function insertAsset(asset: Asset): void {
  const editor = useEditor.getState()
  const project = useProject.getState()
  if (asset.character) {
    const kind = asset.character.kind
    if (!window.confirm(`Rebuild the current model as "${asset.name}"? You can undo this.`)) return
    regenerateCharacter({
      kind,
      proportions: { ...DEFAULT_PROPORTIONS[kind] },
      colors: { ...DEFAULT_COLORS[kind], ...asset.character.colors },
    })
    return
  }
  const id = project.addLayer({ name: asset.name })
  if (asset.part) {
    project.setLayerPart(id, asset.part)
    if (asset.part === 'weapon') {
      const arm = project.layers.find((l) => l.part === 'armR')
      if (arm?.pivot) project.updateLayer(id, { pivot: [...arm.pivot] })
    }
  }
  const hover = editor.hover?.place
  const at: [number, number, number] = hover
    ? [hover[0], hover[1], hover[2]]
    : [Math.floor((grid.bounds[0] - asset.size[0]) / 2), 0, Math.floor((grid.bounds[2] - asset.size[2]) / 2)]
  placeVoxels(asset.voxels, at, `Insert ${asset.name}`)
}

export function AssetsPanel() {
  const user = useAssets((s) => s.user)
  const load = useAssets((s) => s.load)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<AssetCategory | 'all'>('all')
  const [name, setName] = useState('')
  const [saveCategory, setSaveCategory] = useState<AssetCategory>('prop')
  const selectionSize = useEditor((s) => s.selection.size)
  useEffect(() => { load() }, [load])

  const all = useMemo(() => [...BUILTIN_ASSETS, ...user], [user])
  const filtered = all.filter((a) => {
    if (category !== 'all' && a.category !== category) return false
    const q = query.trim().toLowerCase()
    return !q || a.name.toLowerCase().includes(q) || a.tags.some((t) => t.includes(q))
  })

  const saveAsset = () => {
    const editor = useEditor.getState()
    const project = useProject.getState()
    const cells = editor.selection.size > 0
      ? [...editor.selection]
      : (() => {
        const out: number[] = []
        grid.forEach((x, y, z, _c, l) => { if (l === project.activeLayerId) out.push(x | (y << 8) | (z << 16)) })
        return out
      })()
    const box = cellsBox(cells)
    if (!box) { editor.say('Nothing to save: select voxels or fill the active layer'); return }
    const items = cells.filter((p) => grid.has(unpackX(p), unpackY(p), unpackZ(p))).map((p) => {
      const x = unpackX(p), y = unpackY(p), z = unpackZ(p)
      return { x, y, z, color: grid.getColor(x, y, z), mat: grid.getMaterial(x, y, z) }
    })
    const layer = project.layers.find((l) => l.id === project.activeLayerId)
    const asset = makeAsset(uid(), name.trim() || layer?.name || 'My asset', saveCategory, [saveCategory, 'custom'], items, layer?.part)
    useAssets.getState().add(asset)
    setName('')
    editor.say(`Saved asset "${asset.name}"`)
  }

  return (
    <div>
      <Section title="Asset library">
        <input
          placeholder="Search assets..."
          className="w-full rounded border border-neutral-600 bg-neutral-900 px-2 py-1 text-xs"
          value={query} onChange={(e) => setQuery(e.target.value)}
        />
        <div className="flex flex-wrap gap-1">
          <Btn small active={category === 'all'} onClick={() => setCategory('all')}>All</Btn>
          {ASSET_CATEGORIES.map((c) => (
            <Btn key={c} small active={category === c} onClick={() => setCategory(c)}>{c}</Btn>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {filtered.map((a) => (
            <div key={a.id} className="flex flex-col rounded border border-neutral-700 bg-neutral-950 p-1.5">
              <div className="flex h-16 items-center justify-center overflow-hidden rounded bg-neutral-900">
                {a.character
                  ? <span className="text-[10px] uppercase tracking-wide text-neutral-500">{a.character.kind}</span>
                  : <img src={thumbnail(a)} alt={a.name} className="swatch max-h-16 max-w-full" style={{ imageRendering: 'pixelated', width: Math.min(60, a.size[0] * 4) }} />}
              </div>
              <div className="mt-1 truncate text-xs text-neutral-200" title={a.name}>{a.name}</div>
              <div className="text-[10px] text-neutral-500">{a.category}{a.builtin ? '' : ' (yours)'}</div>
              <div className="mt-1 flex gap-1">
                <Btn small className="flex-1" onClick={() => insertAsset(a)}>{a.character ? 'Build' : 'Insert'}</Btn>
                {!a.builtin && <Btn small onClick={() => useAssets.getState().remove(a.id)}>Del</Btn>}
              </div>
            </div>
          ))}
        </div>
        {filtered.length === 0 && <p className="text-xs text-neutral-500">No assets match.</p>}
      </Section>

      <Section title="Save reusable part">
        <Row label="Name">
          <input className="w-32 rounded border border-neutral-600 bg-neutral-900 px-1 py-0.5 text-xs" value={name} onChange={(e) => setName(e.target.value)} placeholder="Layer name" />
        </Row>
        <Row label="Category">
          <select className="rounded border border-neutral-600 bg-neutral-900 px-1 py-0.5 text-xs" value={saveCategory} onChange={(e) => setSaveCategory(e.target.value as AssetCategory)}>
            {ASSET_CATEGORIES.filter((c) => c !== 'character').map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Row>
        <Btn small onClick={saveAsset}>{selectionSize > 0 ? `Save selection (${selectionSize})` : 'Save active layer'}</Btn>
        <p className="text-[11px] text-neutral-500">Inserted assets go into a new layer at the hovered cell. Your assets are stored in this browser.</p>
      </Section>
    </div>
  )
}
