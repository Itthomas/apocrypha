/**
 * roles/remoteWorker.ts — Remote harvesting worker
 *
 * Assigned to a specific source in a remote room. Two modes:
 *
 *   GATHERING: follow precomputed road path to source, harvest until
 *              carry full. Always moves toward source even when empty.
 *   HAULING:   → build closest construction site (if any)
 *              → repair closest damaged road/container (lock until full)
 *              → travelToRoom home, deposit energy in storage
 *
 * Loot override picks up nearby dropped energy/tombstones (survivor pattern).
 * Repair locks onto target until it's fully healed or energy runs out.
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
  pathIndex?: number;
  repairTargetId?: Id<Structure>;
  route?: Array<{ exit: ExitConstant; room: string }>;
  routeRoom?: string;
  lastRoom?: string;
}

export function run(creep: Creep): boolean {
  const mem = creep.memory as RemoteWorkerMemory;
  if (mem.task === undefined) mem.task = TASK.GATHER;
  mem.lastRoom = creep.room.name;

  // ── Loot override: pick up nearby dropped energy/tombstones ──
  if (creep.store.getUsedCapacity() < creep.store.getCapacity() * 0.8) {
    const dropped = creep.pos.findClosestByRange(FIND_DROPPED_RESOURCES, {
      filter: r => r.resourceType === RESOURCE_ENERGY && r.amount > 0
    });
    const tombstone = creep.pos.findClosestByRange(FIND_TOMBSTONES, {
      filter: t => t.store.getUsedCapacity(RESOURCE_ENERGY) > 0
    });
    const distDropped = dropped ? creep.pos.getRangeTo(dropped) : Infinity;
    const distTomb = tombstone ? creep.pos.getRangeTo(tombstone) : Infinity;
    if (distDropped <= 8 && distDropped <= distTomb) {
      if (creep.pickup(dropped!) === ERR_NOT_IN_RANGE) creep.moveTo(dropped!);
      return true;
    }
    if (distTomb <= 8) {
      if (creep.withdraw(tombstone!, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) creep.moveTo(tombstone!);
      return true;
    }
  }

  // ── GATHERING ──
  if (mem.task === TASK.GATHER) {
    const srcPos = mem.sourcePos;
    if (!srcPos) return false;

    // In remote room — harvest the assigned source
    if (creep.room.name === mem.targetRoom) {
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

      // Always move toward source
      if (creep.pos.getRangeTo(srcPos.x, srcPos.y) > 1) {
        creep.moveTo(new RoomPosition(srcPos.x, srcPos.y, mem.targetRoom));
        return true;
      }

      // Harvest if not full
      if (creep.store.getFreeCapacity() > 0 && source.energy > 0) {
        creep.harvest(source);
        return true;
      }

      // Carry full → switch to hauling
      if (creep.store.getFreeCapacity() === 0) {
        delete mem.pathIndex;
        mem.task = TASK.HAUL;
        return true;
      }

      return true;
    }

    // Not at source — follow precomputed road path
    if (mem.pathIndex === undefined) mem.pathIndex = 0;
    if (!followRoadPath(creep, mem)) {
      delete mem.pathIndex;
      travelToRoom(creep, mem.targetRoom);
    }
    return true;
  }

  // ── HAULING ──
  if (mem.task === TASK.HAUL) {
    if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
      delete mem.repairTargetId;
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

    // Priority 2: repair damaged road or container (lock until full)
    if (creep.room.name === mem.targetRoom || creep.room.name === mem.sourceRoom) {
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

// ── Road path following ──

function followRoadPath(creep: Creep, mem: RemoteWorkerMemory): boolean {
  const rooms = (Memory.rooms[mem.sourceRoom] as any)?.remoteRooms;
  if (!rooms || !rooms[mem.targetRoom]) return false;
  const entry = rooms[mem.targetRoom];
  const roadPath = entry?.roadPath?.sources?.[mem.sourceIdx];
  if (!roadPath || roadPath.length === 0) return false;

  let idx = mem.pathIndex || 0;

  while (idx < roadPath.length) {
    const tile = roadPath[idx];
    if (tile.room === creep.room.name && creep.pos.getRangeTo(tile.x, tile.y) <= 1) {
      idx++;
      continue;
    }
    break;
  }

  if (idx >= roadPath.length) return false;

  const next = roadPath[idx];
  if (next.room !== creep.room.name) {
    const exitDir = Game.map.findExit(creep.room.name, next.room);
    if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
      const exit = creep.pos.findClosestByPath(exitDir);
      if (exit) creep.moveTo(exit, { maxRooms: 1 });
    }
  } else {
    creep.moveTo(new RoomPosition(next.x, next.y, next.room));
  }

  mem.pathIndex = idx;
  return true;
}

// ── Repair ──

function tryRepairNearby(creep: Creep, mem: RemoteWorkerMemory): boolean {
  // Lock onto current repair target until fully healed or out of energy
  if (mem.repairTargetId) {
    const target = Game.getObjectById(mem.repairTargetId);
    if (target && target.hits < target.hitsMax) {
      if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
        mem.repairTargetId = undefined;
        return false;
      }
      if (creep.repair(target) === ERR_NOT_IN_RANGE) creep.moveTo(target);
      return true;
    }
    mem.repairTargetId = undefined;
  }

  // Find closest damaged road or container below 2/3 health to start repairing
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
