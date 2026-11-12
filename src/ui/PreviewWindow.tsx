import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { useUi } from '../store/editorStore'
import { grid, useProject } from '../store/projectStore'
import { useView } from '../store/viewStore'
import { AnimStage } from '../viewport/animStage'
import { Btn } from './common'

export function PreviewWindow() {
  const host = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 24, y: 72 })
  const [spin, setSpin] = useState(true)
  const spinRef = useRef(spin)
  spinRef.current = spin

  useEffect(() => {
    const el = host.current!
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    el.appendChild(renderer.domElement)
    renderer.domElement.style.display = 'block'
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 2000)
    const ambient = new THREE.AmbientLight(0xffffff)
    const sun = new THREE.DirectionalLight(0xffffff)
    sun.position.set(40, 80, 60)
    scene.add(ambient, sun)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.autoRotate = true
    controls.autoRotateSpeed = 2

    let stage: AnimStage | null = null
    let timer = 0
    let framed = false

    const applyFrame = () => {
      const p = useProject.getState()
      const anim = p.animations.find((a) => a.id === p.activeAnimId) ?? null
      const f = anim ? Math.min(useUi.getState().frame, anim.length - 1) : 0
      stage?.setFrame(anim, f)
    }

    const rebuild = () => {
      if (stage) {
        scene.remove(stage.root)
        stage.dispose()
      }
      stage = new AnimStage(grid, useProject.getState().layers)
      scene.add(stage.root)
      applyFrame()
      if (!framed) {
        const box = grid.bbox()
        if (box) {
          const c = new THREE.Vector3((box.min[0] + box.max[0] + 1) / 2, (box.min[1] + box.max[1] + 1) / 2, (box.min[2] + box.max[2] + 1) / 2)
          const r = Math.max(6, Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]) / 2)
          controls.target.copy(c)
          camera.position.copy(c).add(new THREE.Vector3(0.8, 0.5, 1).normalize().multiplyScalar(r * 3))
          framed = true
        }
      }
    }
    const scheduleRebuild = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(rebuild, 200)
    }

    const syncLights = () => {
      const v = useView.getState()
      scene.background = new THREE.Color(v.background)
      ambient.intensity = v.ambient * Math.PI
      sun.intensity = v.lightIntensity * Math.PI
    }
    syncLights()
    rebuild()

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight
      if (w === 0 || h === 0) return
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(el)
    resize()

    const unsubs = [
      grid.subscribe(scheduleRebuild),
      useProject.subscribe((s, prev) => {
        if (s.layers !== prev.layers) scheduleRebuild()
        if (s.animations !== prev.animations || s.activeAnimId !== prev.activeAnimId) applyFrame()
      }),
      useUi.subscribe((s, prev) => { if (s.frame !== prev.frame) applyFrame() }),
      useView.subscribe(syncLights),
    ]

    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      controls.autoRotate = spinRef.current
      controls.update()
      renderer.render(scene, camera)
    }
    loop()

    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(timer)
      ro.disconnect()
      unsubs.forEach((u) => u())
      controls.dispose()
      stage?.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  const startDrag = (e: React.PointerEvent) => {
    const sx = e.clientX - pos.x, sy = e.clientY - pos.y
    const move = (m: PointerEvent) => setPos({ x: Math.max(0, m.clientX - sx), y: Math.max(0, m.clientY - sy) })
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const ui = useUi()
  const project = useProject()
  const anim = project.animations.find((a) => a.id === project.activeAnimId)

  return (
    <div
      className="fixed z-40 flex min-h-48 min-w-64 resize flex-col overflow-hidden rounded-lg border border-neutral-600 bg-neutral-900 shadow-2xl"
      style={{ left: pos.x, top: pos.y, width: 320, height: 380 }}
    >
      <div className="flex cursor-move items-center gap-1 border-b border-neutral-700 bg-neutral-800 px-2 py-1" onPointerDown={startDrag}>
        <span className="flex-1 truncate text-xs font-medium">Preview{anim ? `: ${anim.name}` : ''}</span>
        <div onPointerDown={(e) => e.stopPropagation()} className="flex gap-1">
          <select
            className="rounded border border-neutral-600 bg-neutral-900 px-1 text-[11px]" title="Playback speed"
            value={ui.playSpeed} onChange={(e) => ui.set({ playSpeed: Number(e.target.value) })}
          >
            {[0.25, 0.5, 1, 1.5, 2].map((s) => <option key={s} value={s}>{s}x</option>)}
          </select>
          <Btn small active={ui.playing} onClick={() => ui.set({ playing: !ui.playing })}>{ui.playing ? 'Pause' : 'Play'}</Btn>
          <Btn small active={spin} onClick={() => setSpin(!spin)}>Spin</Btn>
          <Btn small onClick={() => ui.set({ previewOpen: false })}>x</Btn>
        </div>
      </div>
      <div ref={host} className="min-h-0 flex-1" />
    </div>
  )
}
