/**
 * roles/remoteWorker.ts — Remote harvesting worker
 *
 * Assigned to a specific source in a remote room. Two modes:
 *
 *   GATHERING: transit to assigned source, harvest until carry full
 *   HAULING:   → build closest construction site (if any)
 *              → repair closest damaged road/container (< 2/3 health)
 *              → deposit energy in source room storage
 *
 * Task switching is persistent — tasks don't thrash between ticks.
 */

import { travelToRoom } from '../lib/travel';

const TASK = { GATHER: 0, HAUL: 1 };

interface RemoteWorkerMemory {
  role: 'remoteWorker';
  targetRoom: string;
  sourceRoom: string;
  task: number;
  sourceIdx: number;
  sourcePos: { x: number; y: number };
  repairTargetId?: Id<Structure>;
  route?: Array<{ exit: ExitConstant; room: string }>;
  routeRoom?: string;
  lastRoom?: string;
}

export function run(creep: Creep): boolean {
  const mem = creep.memory as RemoteWorkerMemory;
  if (mem.task === undefined) mem.task = TASK.GATHER;
  mem.lastRoom = creep.room.name;

  // ── GATHERING ──
  if (mem.task === TASK.GATHER) {
    const srcPos = mem.sourcePos;
    if (!srcPos) return false;

    // Not in remote room → travel there
    if (creep.room.name !== mem.targetRoom) {
      travelToRoom(creep, mem.targetRoom);
      return true;
    }

    // In remote room — harvest the assigned source
    const source = creep.room.lookForAt(LOOK_SOURCES, srcPos.x, srcPos.y)[0];
    if (!source) return false;

    // Repair container when source is depleted
    if (source.energy === 0) {
      const container = creep.pos.findInRange(FIND_STRUCTURES, 1, {
        filter: s => s.structureType === STRUCTURE_CONTAINER
      })[0];
      if (container && container.hits < container.hitsMax) {
        creep.repair(container);
        return true;
      }
    }

    // Harvest until carry is full
    if (creep.store.getFreeCapacity() > 0 && source.energy > 0) {
      if (creep.harvest(source) === ERR_NOT_IN_RANGE) creep.moveTo(source);
      return true;
    }

    // Carry full → switch to hauling
    mem.task = TASK.HAUL;
    return true;
  }

  // ── HAULING ──
  if (mem.task === TASK.HAUL) {
    // Empty → switch back to gathering
    if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
      mem.task = TASK.GATHER;
      return true;
    }

    // Priority 1: build closest construction site (in remote room)
    if (creep.room.name === mem.targetRoom) {
      const site = creep.pos.findClosestByPath(FIND_CONSTRUCTION_SITES);
      if (site) {
        if (creep.build(site) === ERR_NOT_IN_RANGE) creep.moveTo(site);
        return true;
      }
    }

    // Priority 2: repair damaged road or container (< 2/3 health)
    if (creep.room.name === mem.targetRoom) {
      if (tryRepairNearby(creep, mem)) return true;
    }

    // Priority 3: travel home and deposit
    if (creep.room.name !== mem.sourceRoom) {
      travelToRoom(creep, mem.sourceRoom);
      repairRoadUnderfoot(creep);
      return true;
    }

    const storage = creep.room.storage;
    if (storage && storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
      if (creep.transfer(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) creep.moveTo(storage);
      return true;
    }
    const spawn = creep.pos.findClosestByPath(FIND_MY_SPAWNS, {
      filter: s => (s as StructureSpawn).store.getFreeCapacity(RESOURCE_ENERGY) > 0
    });
    if (spawn) {
      if (creep.transfer(spawn, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) creep.moveTo(spawn);
      return true;
    }

    return true;
  }

  return false;
}

// ── Repair ──

function tryRepairNearby(creep: Creep, mem: RemoteWorkerMemory): boolean {
  // If we have a locked repair target, stick to it
  if (mem.repairTargetId) {
    const target = Game.getObjectById(mem.repairTargetId);
    if (target && target.hits < target.hitsMax * 0.67) {
      if (creep.repair(target) === ERR_NOT_IN_RANGE) creep.moveTo(target);
      return true;
    }
    mem.repairTargetId = undefined;
  }

  // Find closest damaged road or container below 2/3 health
  const damaged = creep.pos.findClosestByPath(FIND_STRUCTURES, {
    filter: s => {
      if (s.structureType === STRUCTURE_ROAD || s.structureType === STRUCTURE_CONTAINER) {
        return s.hits < s.hitsMax * 0.67;
      }
      return false;
    }
  });
  if (damaged) {
    mem.repairTargetId = damaged.id;
    if (creep.repair(damaged) === ERR_NOT_IN_RANGE) creep.moveTo(damaged);
    return true;
  }

  return false;
}

function repairRoadUnderfoot(creep: Creep): void {
  if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) return;
  const roads = creep.room.lookForAt(LOOK_STRUCTURES, creep.pos.x, creep.pos.y)
    .filter(s => s.structureType === STRUCTURE_ROAD) as StructureRoad[];
  for (const road of roads) {
    if (road.hits < road.hitsMax * 0.5) {
      creep.repair(road);
      break;
    }
  }
}
