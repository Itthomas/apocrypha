/**
 * roles/reserver.ts — Remote room reservation creep
 *
 * Travels to an adjacent room and maintains controller reservation.
 * Uses 2 CLAIM parts for +1 net reservation per tick, builds to
 * 5000-cap then maintains steady-state. If the controller has a
 * foreign reservation, attackController strips it before reserving.
 * CLAIM creeps have reduced lifetime (500 ticks per CLAIM part).
 */

import { travelToRoom } from '../lib/travel';
import { updateReserveTicks } from '../remoteHarvesting';

interface ReserverMemory {
  role: 'reserver';
  targetRoom: string;
  sourceRoom: string;
  ourUsername?: string;
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

  // Lazy-init our username from the source room's controller
  if (!mem.ourUsername) {
    const homeRoom = Game.rooms[mem.sourceRoom];
    mem.ourUsername = homeRoom?.controller?.owner?.username;
  }

  // Foreign reservation or owned by a third party — attack it first.
  // Each CLAIM part strips 1 tick of reservation per tick, stacking
  // with the natural 1-tick decay (2 CLAIM parts = 3 ticks/tick drain).
  const foreignReservation = controller.reservation &&
    controller.reservation.username !== mem.ourUsername;
  const foreignOwner = controller.owner &&
    controller.owner.username !== mem.ourUsername;

  if (foreignReservation || foreignOwner) {
    const result = creep.attackController(controller);
    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(controller, { maxRooms: 1 });
    }
    return true;
  }

  // No foreign claim — reserve normally
  const result = creep.reserveController(controller);
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(controller, { maxRooms: 1 });
  } else if (result === OK) {
    updateReserveTicks(mem.sourceRoom, mem.targetRoom, controller.reservation?.ticksToEnd || 0);
  }

  return true;
}
