import { useEffect, useRef } from 'react'
import { useEditor } from '../store/editorStore'
import { useProject } from '../store/projectStore'
import { useView } from '../store/viewStore'
import { Btn } from '../ui/common'
import { ViewportEngine, engine, setEngine } from './engine'
import type { ViewName } from './engine'

const VIEWS: { id: ViewName; label: string }[] = [
  { id: 'front', label: 'Front' },
  { id: 'back', label: 'Back' },
  { id: 'left', label: 'Left' },
  { id: 'right', label: 'Right' },
  { id: 'top', label: 'Top' },
  { id: 'iso', label: 'Iso' },
]

export function Viewport() {
  const ref = useRef<HTMLDivElement>(null)
  const hover = useEditor((s) => s.hover)
  const cameraMode = useView((s) => s.cameraMode)
  const count = useProject((s) => s.bounds)

  useEffect(() => {
    const e = new ViewportEngine(ref.current!)
    setEngine(e)
    e.frame()
    return () => {
      e.dispose()
      setEngine(null)
    }
  }, [])

  return (
    <div className="relative min-w-0 flex-1 bg-neutral-950">
      <div ref={ref} className="absolute inset-0" onContextMenu={(e) => e.preventDefault()} />
      <div className="absolute left-2 top-2 flex gap-1 rounded bg-neutral-900/80 p-1 backdrop-blur">
        {VIEWS.map((v) => <Btn key={v.id} small onClick={() => engine?.setView(v.id)}>{v.label}</Btn>)}
        <Btn small onClick={() => engine?.frame()} title="Frame model (Home)">Frame</Btn>
        <Btn small onClick={() => useView.getState().set({ cameraMode: cameraMode === 'perspective' ? 'orthographic' : 'perspective' })}>
          {cameraMode === 'perspective' ? 'Persp' : 'Ortho'}
        </Btn>
      </div>
      <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-neutral-900/80 px-2 py-1 font-mono text-[11px] text-neutral-400">
        {hover ? `x ${hover.cell[0]}  y ${hover.cell[1]}  z ${hover.cell[2]}` : 'x - y - z -'}
        {'  |  grid '}{count.join(' x ')}
      </div>
    </div>
  )
}
