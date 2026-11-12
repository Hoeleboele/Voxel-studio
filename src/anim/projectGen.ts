import type { Animation, Species } from '../core/types'
import { grid, uid, useProject } from '../store/projectStore'
import { generateAllAnimations, generateAnimation, makeContext } from './generate'
import type { GenContext, GenKind, GenOptions, GenerateAllOptions } from './generate'

export function projectContext(species?: Species): GenContext {
  const p = useProject.getState()
  return makeContext(grid, p.layers, species ?? p.meta.species)
}

/** Adds generated animations, replacing earlier generated ones of the same kind and variant. */
function install(anims: Animation[]): void {
  const project = useProject.getState()
  for (const a of anims) {
    const dup = useProject.getState().animations.find((x) => x.kind === a.kind && x.variant === a.variant && x.kind !== 'custom')
    if (dup) project.deleteAnimation(dup.id)
  }
  for (const a of anims) project.addAnimation(a)
  if (anims.length) project.setActiveAnim(anims[0].id)
}

export function generateAllForProject(opts: Partial<GenerateAllOptions> = {}): Animation[] {
  const anims = generateAllAnimations(projectContext(), uid, opts)
  install(anims)
  return anims
}

export function generateOneForProject(kind: GenKind, opts: Partial<GenOptions> = {}): Animation {
  const anim = generateAnimation(kind, projectContext(), uid(), opts)
  install([anim])
  return anim
}
