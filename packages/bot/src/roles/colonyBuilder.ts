/**
 * roles/colonyBuilder.ts — Colonization builder creep
 *
 * Spawned during the 'building' phase. Travels to the target room,
 * then delegates to survivor.run() for normal operation. The spawn
 * site is the only construction target, so TASK.BUILD handles it
 * as part of normal survivor behavior.
 *
 * When the phase completes, these creeps continue as survivors
 * in the new colony until they die naturally.
 */

import { run as survivorRun } from './survivor';

interface ColonyBuilderMemory {
  role: 'colonyBuilder';
  targetRoom: string;
}

export function run(creep: Creep): boolean {
  const mem = creep.memory as ColonyBuilderMemory;

  // ── Not in target room yet → move there ──
  if (creep.room.name !== mem.targetRoom) {
    creep.moveTo(new RoomPosition(25, 25, mem.targetRoom), { reusePath: 50 });
    return true;
  }

  // ── In target room → delegate to survivor ──
  return survivorRun(creep);
}
