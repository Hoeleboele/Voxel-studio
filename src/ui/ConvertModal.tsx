import { useEffect, useMemo, useRef, useState } from 'react'
import { makeMask } from '../convert/analyze'
import { convertSprite, prepareFrames } from '../convert/apply'
import { loadSpriteFiles } from '../convert/files'
import { PARTS, segmentSprite } from '../convert/segment'
import type { BodyKind } from '../convert/segment'
import { keyBackground } from '../convert/slice'
import { DEFAULT_CONVERT } from '../convert/types'
import type { ConvertOptions, DepthMode, RgbaImage, SpriteSource } from '../convert/types'
import { useUi } from '../store/editorStore'
import { useProject } from '../store/projectStore'
import { Btn, Check, Modal, NumberField, Row, Select } from './common'
import { generateAllForProject } from '../anim/projectGen'

const PART_COLORS: Record<string, string> = {
  head: '#f5c542', torso: '#e5484d', armL: '#46a758', armR: '#3e9bd1', legL: '#8e4ec6', legR: '#e93d82',
  legFL: '#8e4ec6', legFR: '#e93d82', legBL: '#6e56cf', legBR: '#d6409f', tail: '#ff990a', weapon: '#ffffff',
  accessory: '#00a2c7', wingL: '#12a594', wingR: '#0d74ce',
}

function Thumb({ img, scale = 3, labels }: { img: RgbaImage; scale?: number; labels?: Int8Array }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    c.width = img.w
    c.height = img.h
    const ctx = c.getContext('2d')!
    const data = ctx.createImageData(img.w, img.h)
    for (let i = 0; i < img.w * img.h; i++) {
      let r = img.data[i * 4], g = img.data[i * 4 + 1], b = img.data[i * 4 + 2]
      const a = img.data[i * 4 + 3]
      const lab = labels?.[i] ?? -1
      if (labels && lab >= 0 && a > 0) {
        const hex = PART_COLORS[PARTS[lab]] ?? '#888888'
        r = parseInt(hex.slice(1, 3), 16); g = parseInt(hex.slice(3, 5), 16); b = parseInt(hex.slice(5, 7), 16)
      }
      data.data.set([r, g, b, a], i * 4)
    }
    ctx.putImageData(data, 0, 0)
  }, [img, labels])
  return <canvas ref={ref} style={{ width: img.w * scale, height: img.h * scale, imageRendering: 'pixelated' }} className="rounded bg-neutral-800" />
}

export function ConvertModal() {
  const close = () => useUi.getState().setModal(null)
  const dirty = useProject((s) => s.dirty)
  const [source, setSource] = useState<SpriteSource | null>(null)
  const [fileName, setFileName] = useState('')
  const [cols, setCols] = useState(0)
  const [rows, setRows] = useState(0)
  const [opts, setOpts] = useState<ConvertOptions>(DEFAULT_CONVERT)
  const [body, setBody] = useState<BodyKind>('auto')
  const [target, setTarget] = useState<'new' | 'add'>('new')
  const [sheetMode, setSheetMode] = useState<'models' | 'animation'>('animation')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const frames = useMemo(() => {
    if (!source) return []
    try { return prepareFrames(source, cols, rows) } catch { return [] }
  }, [source, cols, rows])

  const labelPreview = useMemo(() => {
    if (!frames.length) return null
    const img = keyBackground(frames[0])
    const seg = segmentSprite(img, makeMask(img, opts.alphaThreshold), { detectLayers: opts.detectLayers, body, hints: source?.layerHints })
    return seg ? { img, part: seg.part, kind: seg.kind, facing: seg.facing } : null
  }, [frames, opts.alphaThreshold, opts.detectLayers, body, source])

  const separate = frames.length > 1 && sheetMode === 'models'

  const set = <K extends keyof ConvertOptions>(k: K, v: ConvertOptions[K]) => setOpts((o) => ({ ...o, [k]: v }))

  const load = async (files: File[]) => {
    setMessage('')
    try {
      const src = await loadSpriteFiles(files)
      setSource(src)
      setSheetMode(src.needsSlicing ? 'models' : 'animation')
      setFileName(files[0].name.replace(/\.[^.]+$/, ''))
    } catch (err) {
      setSource(null)
      setMessage(err instanceof Error ? err.message : 'Could not read the sprite')
    }
  }

  const run = (animate: boolean) => {
    if (!source) return
    if (target === 'new' && dirty && !window.confirm('Replace the current project? Unsaved changes will be lost.')) return
    setBusy(true)
    window.setTimeout(() => {
      try {
        const res = convertSprite({ source, frames, opts: { ...opts, body }, name: fileName || 'Sprite', mode: target, separate: separate })
        if (animate) generateAllForProject()
        useUi.getState().set({ rightTab: animate ? 'timeline' : 'structure', frame: 0 })
        close()
        useProject.getState().markDirty()
        console.info(`Converted ${res.voxels} voxels in ${res.layers} layers`)
      } catch (err) {
        setMessage(err instanceof Error ? err.message : 'Conversion failed')
        setBusy(false)
      }
    }, 20)
  }

  return (
    <Modal title="Sprite to 3D" onClose={close} width="max-w-2xl">
      <p className="text-xs text-neutral-300">
        Import PNG sprites, sprite sheets, animated GIFs, Aseprite files (.ase/.aseprite) or an Aseprite JSON export together with its PNG.
      </p>
      <label className="flex h-16 cursor-pointer items-center justify-center rounded border border-dashed border-neutral-600 text-sm text-neutral-400 hover:bg-neutral-800">
        {source ? `${fileName} - choose another file` : 'Choose sprite file(s)'}
        <input type="file" multiple className="hidden" accept=".png,.gif,.ase,.aseprite,.json" onChange={(e) => {
          const list = Array.from(e.target.files ?? [])
          if (list.length) load(list)
          e.target.value = ''
        }} />
      </label>

      {source && (
        <>
          <div className="flex flex-wrap items-start gap-3">
            <div className="space-y-1">
              <div className="text-[10px] uppercase text-neutral-500">Frames ({frames.length})</div>
              <div className="flex max-w-[22rem] flex-wrap gap-1">
                {frames.slice(0, 12).map((f, i) => <Thumb key={i} img={f} scale={Math.max(1, Math.min(3, Math.floor(64 / Math.max(f.w, f.h))))} />)}
                {frames.length > 12 && <span className="self-center text-xs text-neutral-500">+{frames.length - 12}</span>}
              </div>
            </div>
            {labelPreview && (
              <div className="space-y-1">
                <div className="text-[10px] uppercase text-neutral-500">Detected parts ({labelPreview.kind}, {labelPreview.facing})</div>
                <Thumb img={labelPreview.img} labels={labelPreview.part} scale={Math.max(1, Math.min(4, Math.floor(96 / Math.max(labelPreview.img.w, labelPreview.img.h))))} />
              </div>
            )}
          </div>

          {source.needsSlicing && (
            <Row label="Sheet grid (0 = detect automatically)">
              <NumberField value={cols} min={0} max={64} onChange={(n) => setCols(Math.max(0, Math.round(n)))} />
              <span className="text-neutral-500">x</span>
              <NumberField value={rows} min={0} max={64} onChange={(n) => setRows(Math.max(0, Math.round(n)))} />
            </Row>
          )}

          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            <Row label="Depth (voxels)"><NumberField value={opts.depth} min={1} max={64} onChange={(n) => set('depth', Math.max(1, Math.min(64, Math.round(n))))} /></Row>
            <Row label="Scale"><NumberField value={opts.scale} min={1} max={8} onChange={(n) => set('scale', Math.max(1, Math.min(8, Math.round(n))))} /></Row>
            <Row label="Volume">
              <Select<DepthMode> value={opts.mode} onChange={(v) => set('mode', v)} options={[
                { value: 'symmetric', label: 'Solid (dark back)' }, { value: 'solid', label: 'Solid' },
                { value: 'shell', label: 'Hollow shell' }, { value: 'relief', label: 'Relief (flat back)' },
              ]} />
            </Row>
            <Row label="Body">
              <Select<BodyKind> value={body} onChange={setBody} options={[
                { value: 'auto', label: 'Auto-detect' }, { value: 'biped', label: 'Biped' },
                { value: 'quadruped', label: 'Quadruped' }, { value: 'prop', label: 'Single object' },
              ]} />
            </Row>
            <Row label="Shading to depth"><NumberField value={opts.shadingBias} min={0} max={1} step={0.05} onChange={(n) => set('shadingBias', Math.max(0, Math.min(1, n)))} /></Row>
            <Row label="Smoothing"><NumberField value={opts.smoothing} min={0} max={3} onChange={(n) => set('smoothing', Math.max(0, Math.min(3, Math.round(n))))} /></Row>
          </div>
          <Check checked={opts.detectLayers} onChange={(v) => set('detectLayers', v)} label="Detect layers (head, limbs, weapon, armor, clothing)" />
          <Row label="Target">
            <Select value={target} onChange={setTarget} options={[
              { value: 'new', label: 'New project' }, { value: 'add', label: 'Add to current project' },
            ]} />
          </Row>
          {frames.length > 1 && (
            <>
              <Row label="Multiple frames">
                <Select<'models' | 'animation'> value={sheetMode} onChange={setSheetMode} options={[
                  { value: 'models', label: 'Separate 3D model per sprite' }, { value: 'animation', label: 'One model + animation frames' },
                ]} />
              </Row>
              <p className="text-[11px] text-neutral-400">
                {separate ? `${frames.length} sprites become ${frames.length} models, laid out in a grid in sheet order.` : `${frames.length} frames become an animation, in sheet order.`}
              </p>
            </>
          )}
        </>
      )}
      {message && <p className="text-xs text-amber-300">{message}</p>}
      <div className="flex justify-end gap-2">
        <Btn onClick={close}>Cancel</Btn>
        <Btn disabled={!source || busy || frames.length === 0} onClick={() => run(false)}>Convert</Btn>
        <Btn active disabled={!source || busy || frames.length === 0 || !opts.detectLayers || separate} onClick={() => run(true)}>Convert + generate animations</Btn>
      </div>
    </Modal>
  )
}
