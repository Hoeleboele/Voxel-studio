import { flipTarget, rotateTarget, selectAll, selectColor, selectLayer, clearSelection, deleteSelection, copySelection, pasteClipboard, translateSelection, moveSelectionToActiveLayer } from '../tools/actions'
import { useEditor } from '../store/editorStore'
import type { ToolId } from '../store/editorStore'
import { MATERIALS } from '../core/types'
import { Btn, Check, NumberField, Row, Section, toHex } from './common'
import { hexToNum } from '../core/color'

export const TOOLS: { id: ToolId; label: string; key: string; hint: string }[] = [
  { id: 'draw', label: 'Draw', key: 'D', hint: 'Add voxels' },
  { id: 'erase', label: 'Erase', key: 'E', hint: 'Remove voxels' },
  { id: 'paint', label: 'Paint', key: 'P', hint: 'Recolor voxels' },
  { id: 'pick', label: 'Pick', key: 'I', hint: 'Color picker' },
  { id: 'fill', label: 'Fill', key: 'F', hint: 'Flood fill color' },
  { id: 'line', label: 'Line', key: 'L', hint: 'Draw a line' },
  { id: 'box', label: 'Box', key: 'B', hint: 'Create a box' },
  { id: 'sphere', label: 'Sphere', key: 'O', hint: 'Create a sphere' },
  { id: 'select', label: 'Select', key: 'S', hint: 'Select voxels' },
  { id: 'move', label: 'Move', key: 'M', hint: 'Move selection or layer' },
  { id: 'rotate', label: 'Rotate', key: 'R', hint: 'Rotate selection or layer' },
  { id: 'mirror', label: 'Mirror', key: 'T', hint: 'Flip and symmetry' },
]

function ToolOptions() {
  const e = useEditor()
  const t = e.tool
  return (
    <>
      {(t === 'draw' || t === 'erase' || t === 'paint' || t === 'line') && (
        <Row label={`Brush ${e.brush}`}>
          <input type="range" min={1} max={8} value={e.brush} onChange={(ev) => e.setBrush(Number(ev.target.value))} />
        </Row>
      )}
      {t === 'fill' && (
        <Check checked={e.fillPlane} onChange={(v) => e.set({ fillPlane: v })} label="Fill only the clicked face plane" />
      )}
      {(t === 'line' || t === 'box' || t === 'sphere') && (
        <Row label="Mode">
          <Btn small active={e.shapeOp === 'add'} onClick={() => e.set({ shapeOp: 'add' })}>Add</Btn>
          <Btn small active={e.shapeOp === 'erase'} onClick={() => e.set({ shapeOp: 'erase' })}>Subtract</Btn>
        </Row>
      )}
      {(t === 'box' || t === 'sphere') && (
        <Check checked={e.filled} onChange={(v) => e.set({ filled: v })} label="Filled (off = hollow)" />
      )}
      {t === 'box' && (
        <Row label="Extrude">
          <NumberField value={e.extrude} min={1} max={256} onChange={(n) => e.set({ extrude: Math.max(1, Math.round(n)) })} />
        </Row>
      )}
      {t === 'select' && (
        <>
          <Check checked={e.selectThrough} onChange={(v) => e.set({ selectThrough: v })} label="Select through the whole depth" />
          <div className="flex flex-wrap gap-1">
            <Btn small onClick={selectAll}>All</Btn>
            <Btn small onClick={() => selectLayer()}>Layer</Btn>
            <Btn small onClick={() => selectColor(e.color)}>Color</Btn>
            <Btn small onClick={clearSelection}>None</Btn>
          </div>
          <div className="flex flex-wrap gap-1">
            <Btn small onClick={copySelection} disabled={e.selection.size === 0}>Copy</Btn>
            <Btn small onClick={pasteClipboard} disabled={!e.clipboard}>Paste</Btn>
            <Btn small onClick={deleteSelection} disabled={e.selection.size === 0}>Delete</Btn>
            <Btn small onClick={moveSelectionToActiveLayer} disabled={e.selection.size === 0}>To layer</Btn>
          </div>
          <p className="text-[11px] text-neutral-500">Click or drag. Shift adds or removes.</p>
        </>
      )}
      {t === 'move' && (
        <>
          <p className="text-[11px] text-neutral-500">Drag in the viewport, or nudge. Moves the selection, or the active layer if nothing is selected.</p>
          <div className="grid grid-cols-3 gap-1">
            {([['-X', -1, 0, 0], ['+X', 1, 0, 0], ['-Y', 0, -1, 0], ['+Y', 0, 1, 0], ['-Z', 0, 0, -1], ['+Z', 0, 0, 1]] as const).map(([label, x, y, z]) => (
              <Btn key={label} small onClick={() => translateSelection(x, y, z)}>{label}</Btn>
            ))}
          </div>
        </>
      )}
      {t === 'rotate' && (
        <>
          <p className="text-[11px] text-neutral-500">Rotates the selection, or the active layer if nothing is selected.</p>
          <div className="grid grid-cols-2 gap-1">
            {([0, 1, 2] as const).flatMap((axis) => ([1, -1] as const).map((dir) => (
              <Btn key={`${axis}${dir}`} small onClick={() => rotateTarget(axis, dir)}>
                {'XYZ'[axis]} {dir > 0 ? '+90' : '-90'}
              </Btn>
            )))}
          </div>
        </>
      )}
      {t === 'mirror' && (
        <>
          <p className="text-[11px] text-neutral-500">Flip the selection (or active layer) across an axis.</p>
          <div className="flex gap-1">
            {([0, 1, 2] as const).map((axis) => <Btn key={axis} small onClick={() => flipTarget(axis)}>Flip {'XYZ'[axis]}</Btn>)}
          </div>
        </>
      )}
    </>
  )
}

export function ToolPanel() {
  const e = useEditor()
  return (
    <aside className="flex w-56 shrink-0 flex-col overflow-y-auto border-r border-neutral-800 bg-neutral-900">
      <Section title="Tools">
        <div className="grid grid-cols-3 gap-1">
          {TOOLS.map((t) => (
            <Btn key={t.id} active={e.tool === t.id} onClick={() => e.setTool(t.id)} title={`${t.hint} (${t.key})`} className="flex flex-col items-center leading-tight">
              <span>{t.label}</span>
              <span className="text-[9px] opacity-60">{t.key}</span>
            </Btn>
          ))}
        </div>
      </Section>
      <Section title="Tool options">
        <ToolOptions />
      </Section>
      <Section title="Color">
        <div className="flex items-center gap-2">
          <input type="color" className="h-8 w-10" value={toHex(e.color)} onChange={(ev) => e.setColor(hexToNum(ev.target.value))} />
          <input
            className="w-20 rounded border border-neutral-600 bg-neutral-900 px-1 py-0.5 font-mono text-xs"
            value={toHex(e.color)}
            onChange={(ev) => /^#[0-9a-fA-F]{6}$/.test(ev.target.value) && e.setColor(hexToNum(ev.target.value))}
          />
        </div>
        <Row label="Material">
          <select
            className="rounded border border-neutral-600 bg-neutral-900 px-1 py-0.5 text-xs"
            value={e.material}
            onChange={(ev) => e.setMaterial(Number(ev.target.value))}
          >
            {MATERIALS.map((m, i) => <option key={m} value={i}>{m}</option>)}
          </select>
        </Row>
      </Section>
      <Section title="Symmetry">
        <div className="flex gap-1">
          {(['x', 'y', 'z'] as const).map((a) => (
            <Btn key={a} active={e.sym[a]} onClick={() => e.toggleSym(a)} className="flex-1" title={`Mirror across ${a.toUpperCase()} (Shift+${a.toUpperCase()})`}>
              {a.toUpperCase()}
            </Btn>
          ))}
        </div>
        <p className="text-[11px] text-neutral-500">Edits are mirrored live across the grid centre. Combine axes for multi-axis symmetry.</p>
      </Section>
    </aside>
  )
}
