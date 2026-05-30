/**
 * roles/hauler.ts — Energy transport creep
 *
 * Two-task state machine, modeled on the survivor pattern:
 *   GATHER  — withdraw from nearest source container until carry full
 *   DELIVER — spawn → extension → tower → storage, in priority order
 *
 * Transitions:
 *   carry full  → DELIVER (nearest needy target)
 *   carry empty → GATHER
 */

enum HAULER_TASK {
  GATHER = 0,
  DELIVER = 1,
}

interface HaulerMemory {
  role: 'hauler';
  task: HAULER_TASK;
}

export function run(creep: Creep): boolean {
  const mem = creep.memory as HaulerMemory;
  if (mem.task === undefined) mem.task = HAULER_TASK.GATHER;

  // Carry full → deliver
  if (creep.store.getFreeCapacity() === 0 && mem.task !== HAULER_TASK.DELIVER) {
    mem.task = HAULER_TASK.DELIVER;
  }
  // Carry empty → gather
  if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0 && mem.task !== HAULER_TASK.GATHER) {
    mem.task = HAULER_TASK.GATHER;
  }

  // Loot override: pick up nearby dropped energy/tombstones if below 80% carry.
  if (creep.store.getUsedCapacity() < creep.store.getCapacity() * 0.8) {
    const loot = creep.pos.findClosestByRange(FIND_DROPPED_RESOURCES, {
      filter: r => r.resourceType === RESOURCE_ENERGY && r.amount > 0
    }) || creep.pos.findClosestByRange(FIND_TOMBSTONES, {
      filter: t => t.store.getUsedCapacity(RESOURCE_ENERGY) > 0
    });
    if (loot && creep.pos.getRangeTo(loot) <= 8) {
      if (creep.pickup(loot) === ERR_NOT_IN_RANGE) {
        creep.moveTo(loot);
      }
      return true;
    }
  }

  if (mem.task === HAULER_TASK.GATHER) {
    return doGather(creep);
  }
  return doDeliver(creep);
}

// ── GATHER: withdraw from nearest source container ──

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

/** Find the nearest source container with at least minEnergy stored */
function getSourceContainer(creep: Creep, minEnergy: number): StructureContainer | null {
  const sources = creep.room.find(FIND_SOURCES);
  const candidates: StructureContainer[] = [];
  for (const source of sources) {
    const containers = source.pos.findInRange(FIND_STRUCTURES, 2, {
      filter: s =>
        s.structureType === STRUCTURE_CONTAINER &&
        s.store.getUsedCapacity(RESOURCE_ENERGY) >= minEnergy
    });
    for (const c of containers) candidates.push(c as StructureContainer);
  }
  if (candidates.length === 0) return null;
  return creep.pos.findClosestByPath(candidates) as StructureContainer | null;
}

/** True when there are delivery targets that need energy */
function deliveryDemandExists(creep: Creep): boolean {
  // Spawn or extension with free capacity
  const spawnOrExt = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
    filter: s =>
      (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) &&
      s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
  });
  if (spawnOrExt) return true;

  // Tower below 80%
  const tower = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
    filter: s =>
      s.structureType === STRUCTURE_TOWER &&
      s.store.getUsedCapacity(RESOURCE_ENERGY) < s.store.getCapacity(RESOURCE_ENERGY) * 0.8
  });
  return tower !== null;
}

function doGather(creep: Creep): boolean {
  const freeCapacity = creep.store.getFreeCapacity();

  // 1. Prefer a source container that can fully fill us
  const fullContainer = getSourceContainer(creep, freeCapacity);
  if (fullContainer) {
    if (creep.withdraw(fullContainer, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
      creep.moveTo(fullContainer);
    }
    return true;
  }

  // 2. No container can fill us, but there's delivery demand — pull from storage
  if (deliveryDemandExists(creep)) {
    const storage = creep.room.storage;
    if (storage && storage.store.getUsedCapacity(RESOURCE_ENERGY) >= freeCapacity) {
      if (creep.withdraw(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(storage);
      }
      return true;
    }
  }

  // 3. Fall back to the nearest source container, regardless of energy level
  const nearest = getNearestSourceContainer(creep);
  if (nearest) {
    if (creep.withdraw(nearest, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
      creep.moveTo(nearest);
    }
    return true;
  }

  return false;
}

// ── DELIVER: spawn → extension → tower → storage ──

function doDeliver(creep: Creep): boolean {
  // 1. Spawn with free capacity
  const spawn = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
    filter: s =>
      s.structureType === STRUCTURE_SPAWN &&
      s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
  });
  if (spawn) {
    if (creep.transfer(spawn, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) creep.moveTo(spawn);
    return true;
  }

  // 2. Extension with free capacity
  const ext = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
    filter: s =>
      s.structureType === STRUCTURE_EXTENSION &&
      s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
  });
  if (ext) {
    if (creep.transfer(ext, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) creep.moveTo(ext);
    return true;
  }

  // 3. Tower below 90%
  const tower = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
    filter: s =>
      s.structureType === STRUCTURE_TOWER &&
      s.store.getUsedCapacity(RESOURCE_ENERGY) < s.store.getCapacity(RESOURCE_ENERGY) * 0.9
  });
  if (tower) {
    if (creep.transfer(tower, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) creep.moveTo(tower);
    return true;
  }

  // 4. Storage below 80%
  const storage = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
    filter: s =>
      s.structureType === STRUCTURE_STORAGE &&
      s.store.getUsedCapacity(RESOURCE_ENERGY) < s.store.getCapacity(RESOURCE_ENERGY) * 0.8
  });
  if (storage) {
    if (creep.transfer(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) creep.moveTo(storage);
    return true;
  }

  // No delivery targets — idle with full carry
  return false;
}
