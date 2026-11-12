import { distanceField, localMax, luminance } from './analyze'
import type { ConvertOptions, RgbaImage } from './types'

/** Estimated thickness in voxels for every masked pixel (0 outside the silhouette). */
export function thicknessMap(img: RgbaImage, mask: Uint8Array, opts: Pick<ConvertOptions, 'depth' | 'shadingBias' | 'smoothing'>): Float32Array {
  const { w, h } = img
  const n = w * h
  const dist = distanceField(mask, w, h)
  const radius = localMax(dist, w, h, 6)
  const depth = Math.max(1, opts.depth)

  let lumSum = 0
  let count = 0
  for (let i = 0; i < n; i++) if (mask[i]) { lumSum += luminance(img, i); count++ }
  const lumMean = count ? lumSum / count : 0.5

  const t = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue
    const localR = Math.max(1, radius[i])
    const cap = Math.min(depth, 2 * localR)
    const u = Math.min(1, dist[i] / localR)
    const profile = Math.sqrt(Math.max(0, 1 - (1 - u) * (1 - u)))
    let v = cap * profile
    const lum = luminance(img, i)
    v += (lum - lumMean) * opts.shadingBias * depth * 0.6
    // Dark rim pixels stay thin so outlines read as crisp edges.
    if (dist[i] <= 1.01 && lum < 0.25) v *= 0.5
    t[i] = Math.max(1, Math.min(depth, v))
  }

  let cur = t
  for (let pass = 0; pass < Math.round(opts.smoothing); pass++) {
    const next = new Float32Array(n)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        if (!mask[i]) continue
        let sum = 0
        let c = 0
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx
            const yy = y + dy
            if (xx < 0 || yy < 0 || xx >= w || yy >= h || !mask[yy * w + xx]) continue
            sum += cur[yy * w + xx]
            c++
          }
        }
        next[i] = sum / c
      }
    }
    cur = next
  }
  return cur
}
