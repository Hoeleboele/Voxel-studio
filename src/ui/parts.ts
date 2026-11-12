import type { PartId } from '../core/types'

export const PART_IDS: PartId[] = [
  'head', 'torso', 'armL', 'armR', 'legL', 'legR', 'legFL', 'legFR', 'legBL', 'legBR', 'tail', 'weapon', 'accessory', 'wingL', 'wingR',
]

export const OPPOSITE_PART: Partial<Record<PartId, PartId>> = {
  armL: 'armR', armR: 'armL', legL: 'legR', legR: 'legL',
  legFL: 'legFR', legFR: 'legFL', legBL: 'legBR', legBR: 'legBL',
  wingL: 'wingR', wingR: 'wingL',
}
