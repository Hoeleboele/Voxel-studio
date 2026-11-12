import { useEffect } from 'react'
import { history } from '../core/history'
import { saveProjectFile } from '../io/project'
import { useEditor, useUi } from '../store/editorStore'
import type { ToolId } from '../store/editorStore'
import {
  clearSelection, copySelection, deleteSelection, pasteClipboard, selectAll, translateSelection,
} from '../tools/actions'
import { cancelDrag } from '../tools/toolController'
import { engine } from '../viewport/engine'
import { useProject } from '../store/projectStore'

const TOOL_KEYS: Record<string, ToolId> = {
  d: 'draw', e: 'erase', p: 'paint', i: 'pick', f: 'fill', l: 'line', b: 'box', o: 'sphere',
  s: 'select', m: 'move', r: 'rotate', t: 'mirror',
}

export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return
      if (useUi.getState().modal) return
      const ed = useEditor.getState()
      const key = e.key.toLowerCase()
      const mod = e.ctrlKey || e.metaKey

      if (mod) {
        if (key === 'z') { e.preventDefault(); e.shiftKey ? history.redo() : history.undo() }
        else if (key === 'y') { e.preventDefault(); history.redo() }
        else if (key === 's') { e.preventDefault(); saveProjectFile() }
        else if (key === 'c') { e.preventDefault(); copySelection() }
        else if (key === 'v') { e.preventDefault(); pasteClipboard() }
        else if (key === 'a') { e.preventDefault(); selectAll() }
        return
      }
      if (e.shiftKey && 'xyz'.includes(key) && key.length === 1) {
        e.preventDefault()
        ed.toggleSym(key as 'x' | 'y' | 'z')
        return
      }
      if (TOOL_KEYS[key] && !e.altKey) { ed.setTool(TOOL_KEYS[key]); return }
      switch (e.key) {
        case 'Escape': cancelDrag(); clearSelection(); break
        case 'Delete': case 'Backspace': deleteSelection(); break
        case 'Home': engine?.frame(); break
        case '[': ed.setBrush(ed.brush - 1); break
        case ']': ed.setBrush(ed.brush + 1); break
        case 'ArrowLeft': e.preventDefault(); translateSelection(-1, 0, 0); break
        case 'ArrowRight': e.preventDefault(); translateSelection(1, 0, 0); break
        case 'ArrowUp': e.preventDefault(); translateSelection(0, 0, -1); break
        case 'ArrowDown': e.preventDefault(); translateSelection(0, 0, 1); break
        case 'PageUp': e.preventDefault(); translateSelection(0, 1, 0); break
        case 'PageDown': e.preventDefault(); translateSelection(0, -1, 0); break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/** Advances the timeline frame while playback is on. */
export function usePlayback(): void {
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    let acc = 0
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const dt = now - last
      last = now
      const ui = useUi.getState()
      if (!ui.playing) { acc = 0; return }
      const p = useProject.getState()
      const anim = p.animations.find((a) => a.id === p.activeAnimId)
      if (!anim) return
      acc += dt
      const step = 1000 / (anim.fps * Math.max(0.1, ui.playSpeed))
      while (acc >= step) {
        acc -= step
        const next = useUi.getState().frame + 1
        if (next >= anim.length) {
          if (anim.loop) useUi.getState().set({ frame: 0 })
          else useUi.getState().set({ frame: anim.length - 1, playing: false })
        } else useUi.getState().set({ frame: next })
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
}
