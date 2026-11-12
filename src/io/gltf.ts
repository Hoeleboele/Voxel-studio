import * as THREE from 'three'
import { samplePose } from '../anim/pose'
import { srgbToLinear } from '../core/color'
import type { Animation, Layer, Vec3 } from '../core/types'
import type { VoxelGrid } from '../core/voxelGrid'
import { FACE_DIRS, buildExportMesh } from './meshExport'
import { buildRig } from './rig'

export interface GltfOptions {
  binary: boolean
  scale: number
  center: boolean
  rig: boolean
  animations: Animation[]
}

const F32 = 5126
const U8 = 5121
const U16 = 5123
const U32 = 5125

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

class BufferBuilder {
  chunks: Uint8Array[] = []
  views: object[] = []
  accessors: object[] = []
  private offset = 0

  addView(data: ArrayBufferView, target?: number): number {
    const pad = (4 - (this.offset % 4)) % 4
    if (pad) { this.chunks.push(new Uint8Array(pad)); this.offset += pad }
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    this.chunks.push(bytes)
    this.views.push({ buffer: 0, byteOffset: this.offset, byteLength: bytes.length, ...(target ? { target } : {}) })
    this.offset += bytes.length
    return this.views.length - 1
  }

  addAccessor(
    data: ArrayBufferView, componentType: number, count: number, type: string,
    extra: Record<string, unknown> = {}, target?: number,
  ): number {
    const bufferView = this.addView(data, target)
    this.accessors.push({ bufferView, componentType, count, type, ...extra })
    return this.accessors.length - 1
  }

  finish(): Uint8Array {
    const pad = (4 - (this.offset % 4)) % 4
    const out = new Uint8Array(this.offset + pad)
    let o = 0
    for (const c of this.chunks) { out.set(c, o); o += c.length }
    return out
  }
}

export function exportGltf(grid: VoxelGrid, layers: Layer[], opts: GltfOptions): { data: Uint8Array | string; ext: string; rigged: boolean } {
  const mesh = buildExportMesh(grid, layers, { scope: opts.rig ? 'layer' : 'all', scale: opts.scale, center: opts.center })
  if (mesh.quadCount === 0) throw new Error('Nothing to export')
  const rig = opts.rig ? buildRig(grid, layers) : null
  const vc = mesh.quadCount * 4

  const normals = new Float32Array(vc * 3)
  const colors = new Uint8Array(vc * 4)
  const indices = vc < 65536 ? new Uint16Array(mesh.quadCount * 6) : new Uint32Array(mesh.quadCount * 6)
  const joints = rig ? new Uint8Array(vc * 4) : null
  const weights = rig ? new Float32Array(vc * 4) : null
  for (let q = 0; q < mesh.quadCount; q++) {
    const n = FACE_DIRS[mesh.faces[q]]
    const lin = [0, 1, 2].map((c) => Math.round(srgbToLinear(mesh.colors[q * 4 + c]) * 255))
    const bone = rig ? (rig.layerBone.get(mesh.layers[q]) ?? 0) : 0
    for (let k = 0; k < 4; k++) {
      const v = q * 4 + k
      normals.set(n, v * 3)
      colors[v * 4] = lin[0]; colors[v * 4 + 1] = lin[1]; colors[v * 4 + 2] = lin[2]
      colors[v * 4 + 3] = mesh.colors[q * 4 + 3]
      if (joints && weights) { joints[v * 4] = bone; weights[v * 4] = 1 }
    }
    const b = q * 4
    indices.set([b, b + 1, b + 2, b, b + 2, b + 3], q * 6)
  }

  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < mesh.positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = mesh.positions[i + a]
      if (v < min[a]) min[a] = v
      if (v > max[a]) max[a] = v
    }
  }

  const bb = new BufferBuilder()
  const attributes: Record<string, number> = {
    POSITION: bb.addAccessor(mesh.positions, F32, vc, 'VEC3', { min, max }, 34962),
    NORMAL: bb.addAccessor(normals, F32, vc, 'VEC3', {}, 34962),
    COLOR_0: bb.addAccessor(colors, U8, vc, 'VEC4', { normalized: true }, 34962),
  }
  if (joints && weights) {
    attributes.JOINTS_0 = bb.addAccessor(joints, U8, vc, 'VEC4', {}, 34962)
    attributes.WEIGHTS_0 = bb.addAccessor(weights, F32, vc, 'VEC4', {}, 34962)
  }
  const indexAccessor = bb.addAccessor(indices, indices instanceof Uint16Array ? U16 : U32, indices.length, 'SCALAR', {}, 34963)

  const nodes: Record<string, unknown>[] = [{ name: 'VoxelModel', mesh: 0 }]
  const json: Record<string, unknown> = {
    asset: { version: '2.0', generator: 'Voxel Character Studio' },
    scene: 0,
    scenes: [{ nodes: rig ? [0, 1] : [0] }],
    nodes,
    materials: [{
      name: 'VoxelColors',
      pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 },
      alphaMode: mesh.hasAlpha ? 'BLEND' : 'OPAQUE',
    }],
    meshes: [{ name: 'Voxels', primitives: [{ attributes, indices: indexAccessor, material: 0 }] }],
  }

  if (rig) {
    const o = mesh.origin
    const s = mesh.scale
    const head = rig.bones.map((b): Vec3 => [(b.head[0] - o[0]) * s, (b.head[1] - o[1]) * s, (b.head[2] - o[2]) * s])
    rig.bones.forEach((bone, i) => {
      const p = bone.parent
      const t: Vec3 = p < 0 ? head[i] : [head[i][0] - head[p][0], head[i][1] - head[p][1], head[i][2] - head[p][2]]
      const children = rig.bones.map((b, j) => (b.parent === i ? j + 1 : -1)).filter((j) => j >= 0)
      nodes.push({ name: bone.name, translation: t, ...(children.length ? { children } : {}) })
    })
    nodes[0].skin = 0
    const ibm = new Float32Array(rig.bones.length * 16)
    rig.bones.forEach((_b, i) => {
      new THREE.Matrix4().makeTranslation(-head[i][0], -head[i][1], -head[i][2]).toArray(ibm, i * 16)
    })
    json.skins = [{
      name: 'Rig',
      joints: rig.bones.map((_b, i) => i + 1),
      skeleton: 1,
      inverseBindMatrices: bb.addAccessor(ibm, F32, rig.bones.length, 'MAT4'),
    }]

    const gltfAnims: object[] = []
    for (const anim of opts.animations) {
      if (anim.length < 1) continue
      const times = new Float32Array(anim.length)
      for (let f = 0; f < anim.length; f++) times[f] = f / anim.fps
      const timeAcc = bb.addAccessor(times, F32, anim.length, 'SCALAR', { min: [0], max: [times[anim.length - 1]] })
      const trans = rig.bones.map(() => new Float32Array(anim.length * 3))
      const rots = rig.bones.map(() => new Float32Array(anim.length * 4))
      for (let f = 0; f < anim.length; f++) {
        const worlds: THREE.Matrix4[] = []
        rig.bones.forEach((bone, i) => {
          const pose = bone.driver !== null ? samplePose(anim, bone.driver, f) : { pos: [0, 0, 0] as Vec3, rot: [0, 0, 0] as Vec3 }
          const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(
            THREE.MathUtils.degToRad(pose.rot[0]), THREE.MathUtils.degToRad(pose.rot[1]), THREE.MathUtils.degToRad(pose.rot[2]), 'XYZ',
          ))
          const world = new THREE.Matrix4().compose(
            new THREE.Vector3(head[i][0] + pose.pos[0] * s, head[i][1] + pose.pos[1] * s, head[i][2] + pose.pos[2] * s), q, new THREE.Vector3(1, 1, 1),
          )
          worlds.push(world)
          const local = bone.parent < 0 ? world.clone() : worlds[bone.parent].clone().invert().multiply(world)
          const pos = new THREE.Vector3(), rot = new THREE.Quaternion(), scl = new THREE.Vector3()
          local.decompose(pos, rot, scl)
          trans[i].set([pos.x, pos.y, pos.z], f * 3)
          rots[i].set([rot.x, rot.y, rot.z, rot.w], f * 4)
        })
      }
      const samplers: object[] = []
      const channels: object[] = []
      rig.bones.forEach((_b, i) => {
        samplers.push({ input: timeAcc, output: bb.addAccessor(trans[i], F32, anim.length, 'VEC3'), interpolation: 'LINEAR' })
        channels.push({ sampler: samplers.length - 1, target: { node: i + 1, path: 'translation' } })
        samplers.push({ input: timeAcc, output: bb.addAccessor(rots[i], F32, anim.length, 'VEC4'), interpolation: 'LINEAR' })
        channels.push({ sampler: samplers.length - 1, target: { node: i + 1, path: 'rotation' } })
      })
      gltfAnims.push({ name: anim.name, samplers, channels })
    }
    if (gltfAnims.length) json.animations = gltfAnims
  }

  const bin = bb.finish()
  json.bufferViews = bb.views
  json.accessors = bb.accessors

  if (!opts.binary) {
    json.buffers = [{ byteLength: bin.length, uri: 'data:application/octet-stream;base64,' + toBase64(bin) }]
    return { data: JSON.stringify(json, null, 1), ext: 'gltf', rigged: !!rig }
  }

  json.buffers = [{ byteLength: bin.length }]
  const enc = new TextEncoder().encode(JSON.stringify(json))
  const jsonPad = (4 - (enc.length % 4)) % 4
  const jsonBytes = new Uint8Array(enc.length + jsonPad).fill(0x20)
  jsonBytes.set(enc)
  const total = 12 + 8 + jsonBytes.length + 8 + bin.length
  const out = new Uint8Array(total)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, 0x46546c67, true)
  dv.setUint32(4, 2, true)
  dv.setUint32(8, total, true)
  dv.setUint32(12, jsonBytes.length, true)
  dv.setUint32(16, 0x4e4f534a, true)
  out.set(jsonBytes, 20)
  const binStart = 20 + jsonBytes.length
  dv.setUint32(binStart, bin.length, true)
  dv.setUint32(binStart + 4, 0x004e4942, true)
  out.set(bin, binStart + 8)
  return { data: out, ext: 'glb', rigged: !!rig }
}
