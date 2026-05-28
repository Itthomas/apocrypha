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
  /** Last task switch tick — prevents rapid switching */
  taskLockedUntil: number;
}

/** How long to lock a task after switching (prevents thrashing) */
const TASK_LOCK_TICKS = 20;

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
    releaseClaim(creep);
    setTask(creep, Task.DELIVER, mem);
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

  // 1c. Nothing to deliver → switch tasks immediately (no lock delay when idle)
  const nextTask = findHighestPriorityTask(creep);
  setTask(creep, nextTask, mem);
  return true;
}

// ── Task: Build ──

function doBuild(creep: Creep, mem: SurvivorMemory): boolean {
  // ALWAYS interrupt building if spawn/extensions need energy and we have it
  if (creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
    const hungry = creep.room.find(FIND_MY_STRUCTURES, {
      filter: s =>
        (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) &&
        s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
    });
    if (hungry.length > 0) {
      setTask(creep, Task.DELIVER, mem);
      return doDeliver(creep, mem);
    }
  }

  // All current sites are equal priority (batch system). Build nearest one.
  const target = creep.pos.findClosestByPath(FIND_CONSTRUCTION_SITES);
  if (!target) {
    if (canSwitchTask(mem)) setTask(creep, Task.HARVEST, mem);
    return false;
  }

  const result = creep.build(target);
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(target);
  } else if (result === ERR_NOT_ENOUGH_ENERGY) {
    if (canSwitchTask(mem)) setTask(creep, Task.HARVEST, mem);
  }

  return true;
}

// ── Source slot claiming (prevents thrashing) ──

interface SourceClaims {
  [sourceId: string]: Record<string, string>; // "x,y" → creepName
}

/** Get or init the claims object */
function getClaims(): SourceClaims {
  if (!Memory.sourceClaims) Memory.sourceClaims = {};
  return Memory.sourceClaims as SourceClaims;
}

/** Clean dead-creep claims */
function cleanClaims(): void {
  const claims = getClaims();
  for (const sourceId in claims) {
    for (const slot in claims[sourceId]) {
      const name = claims[sourceId][slot];
      if (!(name in Game.creeps)) delete claims[sourceId][slot];
    }
    if (Object.keys(claims[sourceId]).length === 0) delete claims[sourceId];
  }
}

/** Get accessible slots for a source (adjacent non-wall tiles) */
function getSlots(source: Source): {x: number, y: number}[] {
  const slots: {x: number, y: number}[] = [];
  const room = Game.rooms[source.pos.roomName];
  if (!room) return slots;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      const x = source.pos.x + dx, y = source.pos.y + dy;
      if (room.getTerrain().get(x, y) !== TERRAIN_MASK_WALL) {
        slots.push({x, y});
      }
    }
  }
  return slots;
}

/** Try to claim a slot at a source. Returns the slot if claimed, null if full. */
function claimSlot(creep: Creep, source: Source): {x: number, y: number} | null {
  cleanClaims();
  const claims = getClaims();
  const srcClaims = claims[source.id] || {};
  const slots = getSlots(source);

  // Remove our own old claim at this source
  for (const slot in srcClaims) {
    if (srcClaims[slot] === creep.name) delete srcClaims[slot];
  }

  // Find an unclaimed slot
  for (const slot of slots) {
    const key = slot.x + ',' + slot.y;
    if (!srcClaims[key]) {
      srcClaims[key] = creep.name;
      if (!claims[source.id]) claims[source.id] = {};
      claims[source.id][key] = creep.name;
      return slot;
    }
  }
  return null;
}

/** Release a creep's claim on a source */
function releaseClaim(creep: Creep): void {
  const claims = getClaims();
  for (const sourceId in claims) {
    for (const slot in claims[sourceId]) {
      if (claims[sourceId][slot] === creep.name) delete claims[sourceId][slot];
    }
    if (Object.keys(claims[sourceId]).length === 0) delete claims[sourceId];
  }
}

// ── Task: Harvest ──

function doHarvest(creep: Creep, mem: SurvivorMemory): boolean {
  // Only interrupt harvest to deliver if spawn is CRITICALLY low (<100e empty)
  // Otherwise let the carry fill naturally for better throughput
  if (creep.store.getUsedCapacity(RESOURCE_ENERGY) >= 50) {
    const spawns = creep.room.find(FIND_MY_SPAWNS);
    const spawnEmpty = spawns.some(s => s.store.getFreeCapacity(RESOURCE_ENERGY) > 200);
    if (spawnEmpty) {
      setTask(creep, Task.DELIVER, mem);
      releaseClaim(creep);
      return doDeliver(creep, mem);
    }
  }

  // Pick a source with available slots, nearest first
  const sources = creep.room.find(FIND_SOURCES_ACTIVE)
    .filter(s => s.energy > 0)
    .sort((a, b) => creep.pos.getRangeTo(a) - creep.pos.getRangeTo(b));

  let chosenSource: Source | null = null;
  for (const s of sources) {
    if (claimSlot(creep, s)) {
      chosenSource = s;
      break;
    }
  }

  if (!chosenSource) {
    // All sources full — upgrade controller
    if (canSwitchTask(mem)) setTask(creep, Task.UPGRADE, mem);
    releaseClaim(creep);
    return false;
  }

  const result = creep.harvest(chosenSource);
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(chosenSource);
  } else if (result === OK) {
    trackHarvest(creep.room.name, creep.getActiveBodyparts(WORK) * 2);
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
