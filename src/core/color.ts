export function hexToNum(hex: string): number {
  return parseInt(hex.replace('#', '').slice(0, 6), 16) || 0
}

export function numToHex(n: number): string {
  return '#' + (n & 0xffffff).toString(16).padStart(6, '0')
}

export function rgb(n: number): [number, number, number] {
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function fromRgb(r: number, g: number, b: number): number {
  return ((Math.round(r) & 255) << 16) | ((Math.round(g) & 255) << 8) | (Math.round(b) & 255)
}

const LUT = new Float32Array(256)
for (let i = 0; i < 256; i++) {
  const c = i / 255
  LUT[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}
export function srgbToLinear(byte: number): number { return LUT[byte & 255] }

/** Weighted median-cut quantization. Returns a map from source color to reduced color. */
export function quantizeColors(histogram: Map<number, number>, maxColors: number): Map<number, number> {
  const entries = [...histogram.entries()].map(([color, count]) => ({ color, count, c: rgb(color) }))
  const result = new Map<number, number>()
  if (entries.length <= maxColors) {
    for (const e of entries) result.set(e.color, e.color)
    return result
  }
  type Entry = (typeof entries)[number]
  let boxes: Entry[][] = [entries]
  while (boxes.length < maxColors) {
    let best = -1
    let bestRange = 0
    let bestChannel = 0
    boxes.forEach((box, i) => {
      if (box.length < 2) return
      for (let ch = 0; ch < 3; ch++) {
        let lo = 255, hi = 0
        for (const e of box) {
          if (e.c[ch] < lo) lo = e.c[ch]
          if (e.c[ch] > hi) hi = e.c[ch]
        }
        if (hi - lo > bestRange) {
          bestRange = hi - lo
          best = i
          bestChannel = ch
        }
      }
    })
    if (best < 0) break
    const box = boxes[best].slice().sort((p, q) => p.c[bestChannel] - q.c[bestChannel])
    const total = box.reduce((s, e) => s + e.count, 0)
    let acc = 0
    let split = 1
    for (let i = 0; i < box.length - 1; i++) {
      acc += box[i].count
      split = i + 1
      if (acc >= total / 2) break
    }
    boxes.splice(best, 1, box.slice(0, split), box.slice(split))
  }
  boxes = boxes.filter((b) => b.length > 0)
  for (const box of boxes) {
    let r = 0, g = 0, b = 0, w = 0
    for (const e of box) {
      r += e.c[0] * e.count
      g += e.c[1] * e.count
      b += e.c[2] * e.count
      w += e.count
    }
    const avg = fromRgb(r / w, g / w, b / w)
    for (const e of box) result.set(e.color, avg)
  }
  return result
}
