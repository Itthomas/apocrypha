/**
 * roles/survivor.ts — Apocrypha Survivor (Generalist)
 *
 * RCL 1-2: ONLY role active. Max 4 creeps. Priority order:
 *   1. Fill spawn (and extensions at RCL 2)
 *   2. Build (extensions → containers → roads → other)
 *   3. Harvest energy from sources
 *   4. Upgrade controller (lowest priority)
 *
 * RCL 3+: Backup role. Max 2 creeps. Spawns only when energy economy
 *   is actually faltering (not just a miner aging out).
 *
 * Task thrashing mitigation:
 *   - Source reservation: once assigned a source, stick until full or source depleted
 *   - Build target lock: don't switch construction targets mid-trip
 *   - Energy delivery routes: deliver to nearest structure, don't bounce
 */

import { trackHarvest } from '../telemetry';

/** Task priority enum — lower = higher priority */
enum Task {
  DELIVER = 0,
  BUILD = 1,
  HARVEST = 2,
  UPGRADE = 3,
  IDLE = 4,
}

interface SurvivorMemory {
  role: 'survivor';
  task: Task;
  /** Locked source ID — don't switch mid-trip */
  sourceId?: Id<Source>;
  /** Locked construction target — don't switch mid-trip */
  buildTargetId?: Id<ConstructionSite>;
  /** Last task switch tick — prevents rapid switching */
  taskLockedUntil: number;
}

/** How long to lock a task after switching (prevents thrashing) */
const TASK_LOCK_TICKS = 20;

/** Build target priority — lower = build first */
const BUILD_PRIORITY: Record<string, number> = {
  [STRUCTURE_EXTENSION]: 1,
  [STRUCTURE_CONTAINER]: 2,
  [STRUCTURE_ROAD]:     3,
  [STRUCTURE_TOWER]:    4,
  [STRUCTURE_RAMPART]:  5,
  [STRUCTURE_WALL]:     6,
};

// ── Source reservation (shared across all survivors in the room) ──

interface ReservationEntry {
  creepName: string;
  sourceId: string;
  reservedAt: number;
}

/** Get reserved sources map for the room */
function getReservations(roomName: string): Record<string, string> {
  if (!Memory.sourceReservations) Memory.sourceReservations = {};
  if (!Memory.sourceReservations[roomName]) Memory.sourceReservations[roomName] = {};
  return Memory.sourceReservations[roomName];
}

/** Clean stale reservations (creep dead or reservation expired) */
function cleanReservations(roomName: string): void {
  const res = Memory.sourceReservations?.[roomName];
  if (!res) return;
  for (const sourceId in res) {
    const name = res[sourceId];
    if (!(name in Game.creeps)) {
      delete res[sourceId];
    }
  }
}

/** Attempt to reserve a source for this creep */
function reserveSource(creep: Creep, source: Source): boolean {
  const roomName = creep.room.name;
  const res = getReservations(roomName);
  cleanReservations(roomName);

  // Check if this source is already reserved by someone else
  if (res[source.id] && res[source.id] !== creep.name) return false;

  // Check access slots — count how many creeps are already at/near this source
  const nearby = source.pos.findInRange(FIND_MY_CREEPS, 1, {
    filter: (c: Creep) => c.name !== creep.name && c.memory.role === 'survivor'
  });
  // Each source has up to 3 accessible tiles (depends on terrain). Be conservative: max 2.
  if (nearby.length >= 2) return false;

  // Reserve
  res[source.id] = creep.name;
  return true;
}

/** Release our reservation */
function releaseSource(creep: Creep): void {
  const mem = creep.memory as SurvivorMemory;
  if (!mem.sourceId) return;
  const res = Memory.sourceReservations?.[creep.room.name];
  if (res && res[mem.sourceId] === creep.name) {
    delete res[mem.sourceId];
  }
  mem.sourceId = undefined;
}

// ── Main run ──

export function run(creep: Creep): boolean {
  const mem = creep.memory as SurvivorMemory;

  // Initialize memory
  if (mem.task === undefined) {
    mem.task = Task.HARVEST;
    mem.taskLockedUntil = 0;
  }

  // State transitions
  if (creep.store.getFreeCapacity() === 0 && mem.task !== Task.DELIVER) {
    setTask(creep, Task.DELIVER, mem);
    releaseSource(creep);
  }
  if (creep.store.getUsedCapacity() === 0 && mem.task === Task.DELIVER) {
    setTask(creep, Task.HARVEST, mem);
  }

  // Execute current task
  switch (mem.task) {
    case Task.DELIVER: return doDeliver(creep, mem);
    case Task.BUILD:   return doBuild(creep, mem);
    case Task.HARVEST: return doHarvest(creep, mem);
    case Task.UPGRADE: return doUpgrade(creep, mem);
    default:           return false;
  }
}

function setTask(creep: Creep, task: Task, mem: SurvivorMemory): void {
  mem.task = task;
  mem.taskLockedUntil = Game.time + TASK_LOCK_TICKS;
}

function canSwitchTask(mem: SurvivorMemory): boolean {
  return Game.time >= mem.taskLockedUntil;
}

// ── Task: Deliver energy ──

function doDeliver(creep: Creep, mem: SurvivorMemory): boolean {
  // 1a. Fill spawn first
  const spawn = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_SPAWN && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
  });
  if (spawn) {
    if (creep.transfer(spawn, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) creep.moveTo(spawn);
    return true;
  }

  // 1b. Fill extensions
  const ext = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_EXTENSION && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
  });
  if (ext) {
    if (creep.transfer(ext, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) creep.moveTo(ext);
    return true;
  }

  // 1c. Nothing to deliver → find next task
  if (canSwitchTask(mem)) {
    const nextTask = findHighestPriorityTask(creep);
    setTask(creep, nextTask, mem);
  }
  return true;
}

// ── Task: Build ──

function doBuild(creep: Creep, mem: SurvivorMemory): boolean {
  // Validate current build target
  if (mem.buildTargetId) {
    const target = Game.getObjectById(mem.buildTargetId);
    if (!target) mem.buildTargetId = undefined;
  }

  // Find or refresh build target
  if (!mem.buildTargetId) {
    const sites = creep.room.find(FIND_CONSTRUCTION_SITES);
    sites.sort((a, b) => (BUILD_PRIORITY[a.structureType] || 99) - (BUILD_PRIORITY[b.structureType] || 99));
    if (sites.length > 0) {
      mem.buildTargetId = sites[0].id;
    }
  }

  if (!mem.buildTargetId) {
    // No construction sites — switch to harvest
    if (canSwitchTask(mem)) setTask(creep, Task.HARVEST, mem);
    return false;
  }

  const target = Game.getObjectById(mem.buildTargetId);
  if (!target) {
    mem.buildTargetId = undefined;
    return true;
  }

  const result = creep.build(target);
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(target);
  } else if (result === OK) {
    // Check if finished
    if (!Game.getObjectById(target.id)) {
      mem.buildTargetId = undefined;
    }
  } else if (result === ERR_NOT_ENOUGH_ENERGY) {
    // Out of energy — go harvest
    if (canSwitchTask(mem)) setTask(creep, Task.HARVEST, mem);
  }

  return true;
}

// ── Task: Harvest ──

function doHarvest(creep: Creep, mem: SurvivorMemory): boolean {
  const roomName = creep.room.name;

  // Check if we should switch to building (if sites exist and we have energy)
  const sites = creep.room.find(FIND_CONSTRUCTION_SITES);
  if (sites.length > 0 && creep.store.getUsedCapacity(RESOURCE_ENERGY) >= 25 && canSwitchTask(mem)) {
    setTask(creep, Task.BUILD, mem);
    return doBuild(creep, mem);
  }

  // Validate current source
  if (mem.sourceId) {
    const current = Game.getObjectById(mem.sourceId);
    if (!current || current.energy === 0) {
      releaseSource(creep);
    }
  }

  // Find a source (try reserved one first, then find new)
  let source: Source | null = null;
  if (mem.sourceId) {
    source = Game.getObjectById(mem.sourceId);
  }

  if (!source) {
    // Get valid sources, sorted by distance
    const allSources = creep.room.find(FIND_SOURCES_ACTIVE).filter((s: Source) => s.energy > 0);
    allSources.sort((a, b) => creep.pos.getRangeTo(a) - creep.pos.getRangeTo(b));

    // Try to reserve one (closest available first)
    for (const s of allSources) {
      if (reserveSource(creep, s)) {
        source = s;
        mem.sourceId = s.id;
        break;
      }
    }

    // If all sources are reserved/blocked, try the closest anyway
    if (!source && allSources.length > 0) {
      source = allSources[0];
      // Don't set sourceId — we're sharing, not reserved
    }
  }

  if (!source) {
    // No energy sources available — upgrade controller as last resort
    if (canSwitchTask(mem)) setTask(creep, Task.UPGRADE, mem);
    return false;
  }

  const result = creep.harvest(source);
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(source);
  } else if (result === OK) {
    trackHarvest(creep.room.name, creep.getActiveBodyparts(WORK) * 2);
  } else if (result === ERR_NOT_ENOUGH_ENERGY || result === ERR_BUSY) {
    // Source depleted/busy — release and find another
    releaseSource(creep);
  }

  return true;
}

// ── Task: Upgrade ──

function doUpgrade(creep: Creep, mem: SurvivorMemory): boolean {
  const controller = creep.room.controller;
  if (!controller) return false;

  // Check if something higher priority appeared
  if (canSwitchTask(mem)) {
    const next = findHighestPriorityTask(creep);
    if (next !== Task.UPGRADE) {
      setTask(creep, next, mem);
      return true;
    }
  }

  const result = creep.upgradeController(controller);
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(controller);
  }

  // Out of energy — go harvest
  if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0 && canSwitchTask(mem)) {
    setTask(creep, Task.HARVEST, mem);
  }

  return true;
}

// ── Priority evaluation ──

/** Find the highest priority task available right now */
function findHighestPriorityTask(creep: Creep): Task {
  // 1. Deliver if spawn/extensions need energy
  const needsEnergy = creep.room.find(FIND_MY_STRUCTURES, {
    filter: s =>
      (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) &&
      s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
  });
  if (needsEnergy.length > 0 && creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
    return Task.DELIVER;
  }

  // 2. Build if construction sites exist
  const sites = creep.room.find(FIND_CONSTRUCTION_SITES);
  if (sites.length > 0 && creep.store.getUsedCapacity(RESOURCE_ENERGY) >= 25) {
    return Task.BUILD;
  }

  // 3. Harvest if sources have energy and we're not full
  const sources = creep.room.find(FIND_SOURCES_ACTIVE).filter(s => s.energy > 0);
  if (sources.length > 0 && creep.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
    return Task.HARVEST;
  }

  // 4. Deliver any remaining energy before upgrading
  if (needsEnergy.length > 0 && creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
    return Task.DELIVER;
  }

  // 5. Upgrade controller
  return Task.UPGRADE;
}
