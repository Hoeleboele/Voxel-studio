import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { history } from '../core/history'
import { grid } from '../store/projectStore'

export function useGridRevision(): number {
  return useSyncExternalStore(
    (fn) => grid.subscribe(fn),
    () => grid.revision,
  )
}

export function useHistoryVersion(): number {
  return useSyncExternalStore(
    (fn) => history.subscribe(fn),
    () => history.version,
  )
}

/** Runs `compute` shortly after `deps` change so heavy scans do not run on every edit. */
export function useDebounced<T>(compute: () => T, deps: unknown[], delay = 250): T | undefined {
  const [value, setValue] = useState<T>()
  useEffect(() => {
    const t = window.setTimeout(() => setValue(compute()), delay)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return value
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; small?: boolean }

export function Btn({ active, small, className = '', ...props }: BtnProps) {
  return (
    <button
      {...props}
      className={`rounded border px-2 ${small ? 'py-0.5 text-[11px]' : 'py-1 text-xs'} transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? 'border-indigo-400 bg-indigo-600 text-white'
          : 'border-neutral-600 bg-neutral-800 text-neutral-200 hover:bg-neutral-700'
      } ${className}`}
    />
  )
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="border-b border-neutral-800 p-2">
      <div className="mb-1.5 flex items-center justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">{title}</h3>
        {right}
      </div>
      <div className="space-y-1.5">{children}</div>
    </section>
  )
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs text-neutral-300">
      <span className="shrink-0">{label}</span>
      <span className="flex min-w-0 items-center gap-1">{children}</span>
    </label>
  )
}

export function NumberField({
  value, onChange, min, max, step = 1, className = 'w-16',
}: { value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number; className?: string }) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  return (
    <input
      type="number"
      className={`${className} rounded border border-neutral-600 bg-neutral-900 px-1 py-0.5 text-xs text-neutral-100`}
      value={text}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        setText(e.target.value)
        const n = Number(e.target.value)
        if (e.target.value !== '' && Number.isFinite(n)) onChange(n)
      }}
      onBlur={() => setText(String(value))}
    />
  )
}

export function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-neutral-300">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

export function Select<T extends string>({
  value, onChange, options, className = '',
}: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; className?: string }) {
  return (
    <select
      className={`rounded border border-neutral-600 bg-neutral-900 px-1 py-0.5 text-xs text-neutral-100 ${className}`}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

export function Modal({ title, onClose, children, width = 'max-w-lg' }: {
  title: string; onClose: () => void; children: ReactNode; width?: string
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={onClose}>
      <div
        className={`max-h-[90vh] w-full ${width} overflow-auto rounded-lg border border-neutral-700 bg-neutral-900 shadow-2xl`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-neutral-800 px-4 py-2">
          <h2 className="text-sm font-semibold text-neutral-100">{title}</h2>
          <button className="text-neutral-400 hover:text-white" onClick={onClose} aria-label="Close">x</button>
        </header>
        <div className="space-y-3 p-4">{children}</div>
      </div>
    </div>
  )
}

export function toHex(n: number): string {
  return '#' + (n & 0xffffff).toString(16).padStart(6, '0')
}
