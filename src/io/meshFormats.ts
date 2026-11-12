import { strToU8, zipSync } from 'fflate'
import type { ExportMesh } from './meshExport'
import { FACE_DIRS } from './meshExport'

const fmt = (n: number) => (Math.abs(n) < 1e-9 ? '0' : String(Math.round(n * 1e5) / 1e5))

/** Returns a zip containing the OBJ and its MTL (one material per color). */
export function exportObjZip(mesh: ExportMesh, name: string): Uint8Array {
  const lines: string[] = [`mtllib ${name}.mtl`, `o ${name}`]
  const { positions, colors, faces } = mesh
  for (let i = 0; i < positions.length; i += 3) {
    lines.push(`v ${fmt(positions[i])} ${fmt(positions[i + 1])} ${fmt(positions[i + 2])}`)
  }
  for (const n of FACE_DIRS) lines.push(`vn ${n[0]} ${n[1]} ${n[2]}`)

  const byColor = new Map<number, number[]>()
  for (let q = 0; q < mesh.quadCount; q++) {
    const key = (colors[q * 4] << 16) | (colors[q * 4 + 1] << 8) | colors[q * 4 + 2]
    let list = byColor.get(key)
    if (!list) byColor.set(key, (list = []))
    list.push(q)
  }

  const mtl: string[] = []
  for (const [key, quads] of byColor) {
    const hex = key.toString(16).padStart(6, '0')
    mtl.push(`newmtl c_${hex}`, `Kd ${fmt(((key >> 16) & 255) / 255)} ${fmt(((key >> 8) & 255) / 255)} ${fmt((key & 255) / 255)}`, 'Ks 0 0 0', 'illum 1', '')
    lines.push(`usemtl c_${hex}`)
    for (const q of quads) {
      const b = q * 4 + 1
      const n = faces[q] + 1
      lines.push(`f ${b}//${n} ${b + 1}//${n} ${b + 2}//${n} ${b + 3}//${n}`)
    }
  }
  return zipSync({
    [`${name}.obj`]: strToU8(lines.join('\n') + '\n'),
    [`${name}.mtl`]: strToU8(mtl.join('\n')),
  })
}

export function exportStl(mesh: ExportMesh): Uint8Array {
  const tris = mesh.quadCount * 2
  const out = new Uint8Array(84 + tris * 50)
  const dv = new DataView(out.buffer)
  const header = 'Voxel Character Studio'
  for (let i = 0; i < header.length; i++) out[i] = header.charCodeAt(i)
  dv.setUint32(80, tris, true)
  let o = 84
  const p = mesh.positions
  for (let q = 0; q < mesh.quadCount; q++) {
    const n = FACE_DIRS[mesh.faces[q]]
    for (const tri of [[0, 1, 2], [0, 2, 3]]) {
      dv.setFloat32(o, n[0], true)
      dv.setFloat32(o + 4, n[1], true)
      dv.setFloat32(o + 8, n[2], true)
      o += 12
      for (const v of tri) {
        const i = q * 12 + v * 3
        dv.setFloat32(o, p[i], true)
        dv.setFloat32(o + 4, p[i + 1], true)
        dv.setFloat32(o + 8, p[i + 2], true)
        o += 12
      }
      o += 2
    }
  }
  return out
}
