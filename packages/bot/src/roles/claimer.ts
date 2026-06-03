/**
 * roles/claimer.ts — Colonization claimer creep
 *
 * Spawned when phase changes to 'claiming'. Travels to target room via
 * findRoute exit-by-exit routing, claims the controller, places a spawn
 * construction site at the precomputed optimal position, then helps build it.
 */

import { travelToRoom } from '../lib/travel';

interface ClaimerMemory {
  role: 'claimer';
  targetRoom: string;
  spawnX: number;
  spawnY: number;
  claimed: boolean;
  sitePlaced: boolean;
  lastRoom?: string;
  route?: Array<{ exit: ExitConstant; room: string }>;
  routeRoom?: string;
}

export function run(creep: Creep): boolean {
  const mem = creep.memory as ClaimerMemory;
  mem.lastRoom = creep.room.name;

  // ── Not in target room yet → route there ──
  if (creep.room.name !== mem.targetRoom) {
    travelToRoom(creep, mem.targetRoom);
    return true;
  }

  // ── In target room ──

  // Step 1: Claim the controller
  if (!mem.claimed) {
    const controller = creep.room.controller;
    if (!controller) return false;

    const result = creep.claimController(controller);
    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(controller);
    } else if (result === OK) {
      mem.claimed = true;
      console.log(`[claimer] Controller claimed in ${creep.room.name}`);
    }
    return true;
  }

  // Step 2: Place spawn construction site at optimal position
  if (!mem.sitePlaced) {
    const pos = new RoomPosition(mem.spawnX, mem.spawnY, creep.room.name);
    const result = creep.room.createConstructionSite(pos, STRUCTURE_SPAWN);
    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(pos);
    } else if (result === OK) {
      mem.sitePlaced = true;
      console.log(`[claimer] Spawn site placed at (${mem.spawnX},${mem.spawnY}) in ${creep.room.name}`);
    }
    return true;
  }

  // Step 3: Help build the spawn
  const site = creep.pos.findClosestByPath(FIND_MY_CONSTRUCTION_SITES);
  if (site) {
    if (creep.build(site) === ERR_NOT_IN_RANGE) creep.moveTo(site);
    return true;
  }

  // No build sites — harvest to stockpile energy for the new room
  const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
  if (source) {
    if (creep.harvest(source) === ERR_NOT_IN_RANGE) creep.moveTo(source);
    return true;
  }

  return false;
}
