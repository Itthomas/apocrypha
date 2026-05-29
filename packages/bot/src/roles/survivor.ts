/**
 * roles/survivor.ts — Apocrypha Survivor (Generalist)
 *
 * Task-based state machine:
 *   Each creep has a current TASK. It sticks to that task until:
 *   - Carry is empty (→ switch to HARVEST)
 *   - Carry is full and task is HARVEST (→ switch to next priority task)
 *   - Task target no longer exists (→ switch to next priority task)
 *
 * Priority order for switching: DELIVER → REPAIR → BUILD → UPGRADE (→ HARVEST if nothing else)
 * HARVEST is the fallback — always available if sources have energy.
 *
 * Source slot claiming prevents thrashing (only checked during HARVEST).
 */

import { trackHarvest } from '../telemetry';

enum TASK {
  HARVEST = 0,
  DELIVER = 1,
  REPAIR = 2,
  BUILD = 3,
  UPGRADE = 4,
}

interface SurvivorMemory {
  role: 'survivor';
  task: TASK;
  /** Locked repair target — stick until done or out of energy */
  repairTargetId?: Id<Structure>;
}

// ── Source slot claiming ──

function getClaims(): Record<string, Record<string, string>> {
  if (!Memory.sourceClaims) Memory.sourceClaims = {};
  return Memory.sourceClaims as Record<string, Record<string, string>>;
}

function cleanClaims(): void {
  const claims = getClaims();
  for (const sid in claims) {
    for (const slot in claims[sid]) {
      if (!(claims[sid][slot] in Game.creeps)) delete claims[sid][slot];
    }
    if (Object.keys(claims[sid]).length === 0) delete claims[sid];
  }
}

function claimSlot(creep: Creep, source: Source): {x: number, y: number} | null {
  cleanClaims();
  const claims = getClaims();
  const srcClaims = claims[source.id] || {};
  for (const slot in srcClaims) {
    if (srcClaims[slot] === creep.name) delete srcClaims[slot];
  }
  const room = Game.rooms[source.pos.roomName];
  if (!room) return null;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      if (room.getTerrain().get(source.pos.x + dx, source.pos.y + dy) === TERRAIN_MASK_WALL) continue;
      const key = (source.pos.x + dx) + ',' + (source.pos.y + dy);
      if (!srcClaims[key]) {
        if (!claims[source.id]) claims[source.id] = {};
        claims[source.id][key] = creep.name;
        return {x: source.pos.x + dx, y: source.pos.y + dy};
      }
    }
  }
  return null;
}

function releaseClaim(creep: Creep): void {
  const claims = getClaims();
  for (const sid in claims) {
    for (const slot in claims[sid]) {
      if (claims[sid][slot] === creep.name) delete claims[sid][slot];
    }
    if (Object.keys(claims[sid]).length === 0) delete claims[sid];
  }
}

// ── Task switching ──

/** Returns the next task to switch to, based on priority and availability */
function chooseTask(creep: Creep): TASK {
  // DELIVER: spawn or extensions need energy AND we have energy to give
  const needsEnergy = creep.room.find(FIND_MY_STRUCTURES, {
    filter: s =>
      (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) &&
      s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
  });
  if (needsEnergy.length > 0 && creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
    return TASK.DELIVER;
  }

  // REPAIR: damaged structures below 50% hp (excluding walls and ramparts)
  if (creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
    const damaged = creep.room.find(FIND_STRUCTURES, {
      filter: s =>
        s.hits < s.hitsMax * 0.5 &&
        s.structureType !== STRUCTURE_WALL &&
        s.structureType !== STRUCTURE_RAMPART
    });
    if (damaged.length > 0) return TASK.REPAIR;
  }

  // BUILD: construction sites exist AND we have energy
  if (creep.room.find(FIND_CONSTRUCTION_SITES).length > 0 && creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
    return TASK.BUILD;
  }

  // UPGRADE: we have energy and nothing else needs it
  if (creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
    return TASK.UPGRADE;
  }

  // Fallback: harvest
  return TASK.HARVEST;
}

function setTask(creep: Creep, task: TASK): void {
  const mem = creep.memory as SurvivorMemory;
  if (mem.task !== TASK.HARVEST) releaseClaim(creep);
  if (mem.task !== TASK.REPAIR) mem.repairTargetId = undefined;
  mem.task = task;
}

// ── Main run ──

export function run(creep: Creep): boolean {
  const mem = creep.memory as SurvivorMemory;
  if (mem.task === undefined) mem.task = TASK.HARVEST;

  // HARVEST: keep harvesting until carry is FULL
  if (mem.task === TASK.HARVEST) {
    // If carry is full, switch to next priority task
    if (creep.store.getFreeCapacity() === 0) {
      const next = chooseTask(creep);
      if (next !== TASK.HARVEST) {
        releaseClaim(creep);
        setTask(creep, next);
        return run(creep); // recurse to execute the new task this tick
      }
    }
    // Carry is empty, or no other tasks available — keep harvesting
    // If we have some energy and spawn is critically empty, deliver now
    if (creep.store.getUsedCapacity(RESOURCE_ENERGY) >= 50) {
      const spawns = creep.room.find(FIND_MY_SPAWNS);
      if (spawns.some(s => s.store.getUsedCapacity(RESOURCE_ENERGY) < 100)) {
        setTask(creep, TASK.DELIVER);
        return run(creep);
      }
    }
    return doHarvest(creep);
  }

  // DELIVER: keep delivering until carry is empty or no targets
  if (mem.task === TASK.DELIVER) {
    // Carry empty → switch to harvest
    if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
      setTask(creep, TASK.HARVEST);
      return run(creep);
    }
    return doDeliver(creep);
  }

  // REPAIR: repair nearest damaged structure until full or out of energy
  if (mem.task === TASK.REPAIR) {
    if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
      setTask(creep, TASK.HARVEST);
      return run(creep);
    }
    // Validate current repair target
    if (mem.repairTargetId) {
      const target = Game.getObjectById(mem.repairTargetId);
      if (!target || target.hits >= target.hitsMax) mem.repairTargetId = undefined;
    }
    // Find nearest repairable structure below 50% (exclude walls/ramparts)
    if (!mem.repairTargetId) {
      const damaged = creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: s =>
          s.hits < s.hitsMax * 0.5 &&
          s.structureType !== STRUCTURE_WALL &&
          s.structureType !== STRUCTURE_RAMPART
      });
      if (damaged) mem.repairTargetId = damaged.id;
    }
    if (!mem.repairTargetId) {
      const next = chooseTask(creep);
      if (next !== TASK.REPAIR) { setTask(creep, next); return run(creep); }
      return false;
    }
    const target = Game.getObjectById(mem.repairTargetId);
    if (!target) { mem.repairTargetId = undefined; return false; }
    const result = creep.repair(target);
    if (result === ERR_NOT_IN_RANGE) creep.moveTo(target);
    // If fully repaired, clear target
    if (target.hits >= target.hitsMax) mem.repairTargetId = undefined;
    return true;
  }

  // BUILD: keep building until carry empty or no sites
  if (mem.task === TASK.BUILD) {
    if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
      setTask(creep, TASK.HARVEST);
      return run(creep);
    }
    const site = creep.pos.findClosestByPath(FIND_CONSTRUCTION_SITES);
    if (!site) {
      // No sites left → find something else to do
      const next = chooseTask(creep);
      if (next !== TASK.BUILD) { setTask(creep, next); return run(creep); }
      return false;
    }
    const result = creep.build(site);
    if (result === ERR_NOT_IN_RANGE) creep.moveTo(site);
    return true;
  }

  // UPGRADE: keep upgrading until carry empty
  if (mem.task === TASK.UPGRADE) {
    if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
      setTask(creep, TASK.HARVEST);
      return run(creep);
    }
    if (creep.room.controller) {
      if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
        creep.moveTo(creep.room.controller);
      }
    }
    return true;
  }

  return false;
}

// ── Harvest ──

/**
 * At RCL 3+: withdraw from miner containers instead of harvesting
 * directly from sources. Falls back to direct source harvesting if
 * no container has energy AND no miner creep exists in the room.
 */
function doHarvest(creep: Creep): boolean {
  const rcl = creep.room.controller?.level ?? 0;

  // RCL 3+: try container withdrawal first
  if (rcl >= 3) {
    const sourceContainer = getSourceContainer(creep);
    if (sourceContainer) {
      if (creep.withdraw(sourceContainer, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(sourceContainer);
      }
      return true;
    }

    // No container with energy — check if a miner exists
    const miners = creep.room.find(FIND_MY_CREEPS).filter(c => c.memory.role === 'miner');
    if (miners.length > 0) {
      // Miner exists, container will fill — move toward nearest source container
      // so we're in position when energy arrives
      const nearest = getNearestSourceContainer(creep);
      if (nearest) creep.moveTo(nearest);
      return true;
    }

    // No miner and no container energy — fall through to direct harvesting
  }

  // Direct source harvesting (RCL 1-2, or RCL 3+ fallback)
  const sources = creep.room.find(FIND_SOURCES_ACTIVE)
    .filter(s => s.energy > 0)
    .sort((a, b) => creep.pos.getRangeTo(a) - creep.pos.getRangeTo(b));

  for (const source of sources) {
    if (claimSlot(creep, source)) {
      const result = creep.harvest(source);
      if (result === ERR_NOT_IN_RANGE) creep.moveTo(source);
      else if (result === OK) trackHarvest(creep.room.name, creep.getActiveBodyparts(WORK) * 2);
      return true;
    }
  }

  // All sources full — upgrade controller while waiting
  if (creep.room.controller) {
    if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
      creep.moveTo(creep.room.controller);
    }
  }
  return true;
}

/** Find the nearest source container (adjacent to a source) with ≥ 100 energy */
function getSourceContainer(creep: Creep): StructureContainer | null {
  const sources = creep.room.find(FIND_SOURCES);
  const candidates: StructureContainer[] = [];

  for (const source of sources) {
    const containers = source.pos.findInRange(FIND_STRUCTURES, 2, {
      filter: s =>
        s.structureType === STRUCTURE_CONTAINER &&
        s.store.getUsedCapacity(RESOURCE_ENERGY) >= 100
    });
    for (const c of containers) candidates.push(c as StructureContainer);
  }

  if (candidates.length === 0) return null;
  return creep.pos.findClosestByPath(candidates) as StructureContainer | null;
}

/** Find the nearest source container regardless of energy level */
function getNearestSourceContainer(creep: Creep): StructureContainer | null {
  const sources = creep.room.find(FIND_SOURCES);
  const candidates: StructureContainer[] = [];

  for (const source of sources) {
    const containers = source.pos.findInRange(FIND_STRUCTURES, 2, {
      filter: s => s.structureType === STRUCTURE_CONTAINER
    });
    for (const c of containers) candidates.push(c as StructureContainer);
  }

  if (candidates.length === 0) return null;
  return creep.pos.findClosestByPath(candidates) as StructureContainer | null;
}

// ── Deliver ──

function doDeliver(creep: Creep): boolean {
  // Spawn first
  const spawn = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_SPAWN && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
  });
  if (spawn) {
    if (creep.transfer(spawn, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) creep.moveTo(spawn);
    return true;
  }

  // Extensions
  const ext = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_EXTENSION && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
  });
  if (ext) {
    if (creep.transfer(ext, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) creep.moveTo(ext);
    return true;
  }

  // Nowhere to deliver → switch task
  const next = chooseTask(creep);
  if (next !== TASK.DELIVER) { setTask(creep, next); return run(creep); }
  return false;
}
