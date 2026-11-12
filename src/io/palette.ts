import { hexToNum, numToHex } from '../core/color'
import type { Palette } from '../core/types'
import { uid } from '../store/projectStore'

export function parsePalette(text: string, fileName: string): Palette {
  const name = fileName.replace(/\.[^.]+$/, '') || 'Imported'
  const trimmed = text.trim()
  let colors: number[] = []

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const data = JSON.parse(trimmed)
    const list: unknown[] = Array.isArray(data) ? data : data.colors
    colors = list.map((c) => (typeof c === 'number' ? c : hexToNum(String(c))))
    return { id: uid(), name: (!Array.isArray(data) && data.name) || name, colors }
  }

  if (trimmed.startsWith('GIMP Palette')) {
    for (const line of trimmed.split(/\r?\n/)) {
      const m = line.trim().match(/^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})/)
      if (m) colors.push((Number(m[1]) << 16) | (Number(m[2]) << 8) | Number(m[3]))
    }
    return { id: uid(), name, colors }
  }

  for (const line of trimmed.split(/\r?\n/)) {
    const m = line.trim().match(/^#?([0-9a-fA-F]{6})\b/)
    if (m) colors.push(parseInt(m[1], 16))
  }
  if (colors.length === 0) throw new Error('No colors found in palette file')
  return { id: uid(), name, colors }
}

export function paletteToJson(p: Palette): string {
  return JSON.stringify({ name: p.name, colors: p.colors.map(numToHex) }, null, 2)
}

export function paletteToGpl(p: Palette): string {
  const rows = p.colors.map((c) => `${(c >> 16) & 255} ${(c >> 8) & 255} ${c & 255} ${numToHex(c)}`)
  return `GIMP Palette\nName: ${p.name}\nColumns: 8\n#\n${rows.join('\n')}\n`
}

export function paletteToHex(p: Palette): string {
  return p.colors.map((c) => numToHex(c).slice(1)).join('\n') + '\n'
}
