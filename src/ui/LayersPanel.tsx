import { useState } from 'react'
import { layerTree } from '../core/layers'
import { PART_IDS } from './parts'
import { selectLayer, moveSelectionToActiveLayer } from '../tools/actions'
import { useEditor } from '../store/editorStore'
import { grid, useProject } from '../store/projectStore'
import { Btn, Row, Section, useDebounced, useGridRevision } from './common'

export function LayersPanel() {
  const { layers, activeLayerId, updateLayer, setActiveLayer, addLayer, deleteLayer, moveLayer, setLayerParent, setLayerPart } = useProject()
  const selectionSize = useEditor((s) => s.selection.size)
  const revision = useGridRevision()
  const counts = useDebounced(() => {
    const map = new Map<number, number>()
    grid.forEach((_x, _y, _z, _c, l) => map.set(l, (map.get(l) ?? 0) + 1))
    return map
  }, [revision])
  const [editing, setEditing] = useState<number | null>(null)
  const active = layers.find((l) => l.id === activeLayerId)
  const tree = layerTree(layers)
  const groups = layers.filter((l) => l.isGroup && l.id !== activeLayerId)

  const total = (id: number): number => {
    const own = counts?.get(id) ?? 0
    return own + layers.filter((l) => l.parentId === id).reduce((s, l) => s + total(l.id), 0)
  }

  return (
    <div>
      <Section title="Layers" right={
        <div className="flex gap-1">
          <Btn small onClick={() => addLayer()}>+ Layer</Btn>
          <Btn small onClick={() => addLayer({ group: true })}>+ Group</Btn>
        </div>
      }>
        <ul className="space-y-0.5">
          {tree.map(({ layer, depth }) => (
            <li
              key={layer.id}
              onClick={() => setActiveLayer(layer.id)}
              className={`flex cursor-pointer items-center gap-1 rounded border px-1 py-0.5 text-xs ${
                layer.id === activeLayerId ? 'border-indigo-500 bg-indigo-950/60' : 'border-transparent hover:bg-neutral-800'
              }`}
              style={{ paddingLeft: 4 + depth * 14 }}
            >
              <button
                title={layer.visible ? 'Hide' : 'Show'}
                className={`w-5 rounded text-[10px] ${layer.visible ? 'text-emerald-300' : 'text-neutral-600'}`}
                onClick={(e) => { e.stopPropagation(); updateLayer(layer.id, { visible: !layer.visible }) }}
              >{layer.visible ? 'Vis' : 'Hid'}</button>
              <button
                title={layer.locked ? 'Unlock' : 'Lock'}
                className={`w-5 rounded text-[10px] ${layer.locked ? 'text-amber-300' : 'text-neutral-600'}`}
                onClick={(e) => { e.stopPropagation(); updateLayer(layer.id, { locked: !layer.locked }) }}
              >{layer.locked ? 'Lck' : 'Opn'}</button>
              {editing === layer.id ? (
                <input
                  autoFocus
                  defaultValue={layer.name}
                  className="min-w-0 flex-1 rounded border border-neutral-600 bg-neutral-900 px-1"
                  onBlur={(e) => { updateLayer(layer.id, { name: e.target.value || layer.name }); setEditing(null) }}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditing(null) }}
                />
              ) : (
                <span
                  className={`min-w-0 flex-1 truncate ${layer.isGroup ? 'font-semibold text-neutral-200' : 'text-neutral-300'}`}
                  onDoubleClick={() => setEditing(layer.id)}
                  title="Double-click to rename"
                >
                  {layer.isGroup ? '[G] ' : ''}{layer.name}
                </span>
              )}
              <span className="text-[10px] text-neutral-500">{total(layer.id)}</span>
            </li>
          ))}
        </ul>
      </Section>

      {active && (
        <Section title={`Active: ${active.name}`}>
          <Row label={`Opacity ${Math.round(active.opacity * 100)}%`}>
            <input type="range" min={0.05} max={1} step={0.05} value={active.opacity}
              onChange={(e) => updateLayer(active.id, { opacity: Number(e.target.value) })} />
          </Row>
          <Row label="Parent group">
            <select
              className="max-w-32 rounded border border-neutral-600 bg-neutral-900 px-1 py-0.5 text-xs"
              value={active.parentId ?? ''}
              onChange={(e) => setLayerParent(active.id, e.target.value === '' ? null : Number(e.target.value))}
            >
              <option value="">None</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </Row>
          {!active.isGroup && (
            <Row label="Body part">
              <select
                className="max-w-32 rounded border border-neutral-600 bg-neutral-900 px-1 py-0.5 text-xs"
                value={active.part ?? ''}
                onChange={(e) => {
                  const part = e.target.value === '' ? undefined : (e.target.value as (typeof PART_IDS)[number])
                  setLayerPart(active.id, part)
                  if (part === 'weapon') {
                    const arm = layers.find((l) => l.part === 'armR')
                    if (arm?.pivot) updateLayer(active.id, { pivot: [...arm.pivot] })
                  }
                }}
              >
                <option value="">None</option>
                {PART_IDS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Row>
          )}
          <div className="flex flex-wrap gap-1">
            <Btn small onClick={() => moveLayer(active.id, -1)}>Up</Btn>
            <Btn small onClick={() => moveLayer(active.id, 1)}>Down</Btn>
            <Btn small onClick={() => selectLayer(active.id)} disabled={active.isGroup}>Select voxels</Btn>
            <Btn small onClick={moveSelectionToActiveLayer} disabled={selectionSize === 0 || active.isGroup}>Move selection here</Btn>
            <Btn small onClick={() => {
              if (window.confirm(`Delete "${active.name}" and its voxels?`)) deleteLayer(active.id)
            }}>Delete</Btn>
          </div>
          <p className="text-[11px] text-neutral-500">Locked or hidden layers cannot be edited. Opacity changes the preview only.</p>
        </Section>
      )}
    </div>
  )
}
