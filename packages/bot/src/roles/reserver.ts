/**
 * roles/reserver.ts — Remote room reservation creep
 *
 * Travels to an adjacent room and maintains controller reservation.
 * Uses 2 CLAIM parts for +1 net reservation per tick, builds to
 * 5000-cap then maintains steady-state. CLAIM creeps have reduced
 * lifetime (500 ticks per CLAIM part).
 */

import { travelToRoom } from '../lib/travel';
import { updateReserveTicks } from '../remoteHarvesting';

interface ReserverMemory {
  role: 'reserver';
  targetRoom: string;
  sourceRoom: string;
  route?: Array<{ exit: ExitConstant; room: string }>;
  routeRoom?: string;
  lastRoom?: string;
}

export function run(creep: Creep): boolean {
  const mem = creep.memory as ReserverMemory;
  mem.lastRoom = creep.room.name;

  // Not in target room → travel there
  if (creep.room.name !== mem.targetRoom) {
    travelToRoom(creep, mem.targetRoom, true);
    return true;
  }

  const controller = creep.room.controller;
  if (!controller) return false;

  const result = creep.reserveController(controller);
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(controller, { maxRooms: 1 });
  } else if (result === OK) {
    // Update stored reservation tick estimate
    updateReserveTicks(mem.sourceRoom, mem.targetRoom, controller.reservation?.ticksToEnd || 0);
  }

  return true;
}
