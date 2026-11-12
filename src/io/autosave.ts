import { history } from '../core/history'
import { grid, useProject } from '../store/projectStore'
import { useUi } from '../store/editorStore'
import { useView } from '../store/viewStore'
import { kvDel, kvGet, kvSet } from './kv'
import { loadProjectBytes, serializeProject } from './project'

const KEY = 'autosave'

interface AutosaveRecord { bytes: Uint8Array; time: number }

export async function peekAutosave(): Promise<number | null> {
  try {
    const rec = await kvGet<AutosaveRecord>(KEY)
    return rec ? rec.time : null
  } catch {
    return null
  }
}

export async function restoreAutosave(): Promise<boolean> {
  const rec = await kvGet<AutosaveRecord>(KEY)
  if (!rec) return false
  loadProjectBytes(rec.bytes)
  return true
}

export async function discardAutosave(): Promise<void> {
  await kvDel(KEY)
}

function signature(): string {
  const p = useProject.getState()
  return [grid.revision, history.version, p.layers, p.animations, p.customPalettes, p.meta].map((v) =>
    typeof v === 'object' ? objectId(v as object) : String(v),
  ).join('|')
}

const ids = new WeakMap<object, number>()
let nextObjectId = 1
function objectId(o: object): string {
  let id = ids.get(o)
  if (!id) { id = nextObjectId++; ids.set(o, id) }
  return String(id)
}

/** Writes the project to IndexedDB on an interval while it has unsaved changes. */
export function startAutosave(): () => void {
  let timer = 0
  let lastSig = signature()

  const tick = async () => {
    const view = useView.getState()
    const project = useProject.getState()
    const sig = signature()
    if (view.autosave && project.dirty && sig !== lastSig) {
      try {
        await kvSet(KEY, { bytes: serializeProject(), time: Date.now() } satisfies AutosaveRecord)
        lastSig = sig
      } catch (err) {
        console.warn('Autosave failed', err)
      }
    }
    timer = window.setTimeout(tick, Math.max(5, useView.getState().autosaveSeconds) * 1000)
  }
  timer = window.setTimeout(tick, Math.max(5, useView.getState().autosaveSeconds) * 1000)

  peekAutosave().then((time) => {
    if (time !== null && !useProject.getState().dirty) useUi.getState().set({ restorePrompt: time })
  })
  return () => window.clearTimeout(timer)
}
