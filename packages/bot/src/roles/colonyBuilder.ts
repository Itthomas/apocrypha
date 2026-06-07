/**
 * roles/colonyBuilder.ts — Colonization builder creep
 *
 * Spawned during the 'building' phase. Travels to the target room via
 * findRoute exit-by-exit routing, then delegates to survivor.run() for
 * normal operation. The spawn site is the only construction target, so
 * TASK.BUILD handles it as part of normal survivor behavior.
 *
 * When the phase completes, these creeps continue as survivors
 * in the new colony until they die naturally.
 */

import { travelToRoom } from '../lib/travel';
import { run as survivorRun } from './survivor';

interface ColonyBuilderMemory {
  role: 'colonyBuilder';
  targetRoom: string;
  lastRoom?: string;
  route?: Array<{ exit: ExitConstant; room: string }>;
  routeRoom?: string;
}

export function run(creep: Creep): boolean {
  const mem = creep.memory as ColonyBuilderMemory;
  mem.lastRoom = creep.room.name;

  // ── Not in target room yet → route there ──
  if (creep.room.name !== mem.targetRoom) {
    travelToRoom(creep, mem.targetRoom, false, true);
    return true;
  }

  // ── In target room → delegate to survivor ──
  return survivorRun(creep);
}
