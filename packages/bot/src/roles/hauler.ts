/**
 * roles/hauler.ts — Energy transport creep
 *
 * State machine:
 *   GATHER: lock onto a source container, withdraw until carry is full
 *   DELIVER: lock onto a delivery job in priority order:
 *     1. Fill spawn + extensions
 *     2. Fill spawn overflow container (<80% full)
 *     3. Fill controller container (<80% full)
 *
 * After withdrawing from a source container, switches to DELIVER.
 * After delivering (carry empty or no job), switches back to GATHER.
 *
 * Body: CARRY + MOVE only, no WORK parts. Fast when empty.
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

  // Carry empty → switch to GATHER
  if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0 && mem.task !== HAULER_TASK.GATHER) {
    mem.task = HAULER_TASK.GATHER;
  }
  // Carry full → switch to DELIVER
  if (creep.store.getFreeCapacity() === 0 && mem.task !== HAULER_TASK.DELIVER) {
    mem.task = HAULER_TASK.DELIVER;
  }

  if (mem.task === HAULER_TASK.GATHER) {
    return doGather(creep);
  }

  return doDeliver(creep);
}

// ── GATHER: withdraw from nearest source container with energy ──

function doGather(creep: Creep): boolean {
  // If carry is full, switch to deliver
  if (creep.store.getFreeCapacity() === 0) {
    (creep.memory as HaulerMemory).task = HAULER_TASK.DELIVER;
    return doDeliver(creep);
  }

  // Find source containers with energy (exclude spawn overflow and controller containers)
  const containers = creep.room.find(FIND_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_CONTAINER && s.store.getUsedCapacity(RESOURCE_ENERGY) >= 100
  });

  // Sort by distance
  containers.sort((a, b) => creep.pos.getRangeTo(a) - creep.pos.getRangeTo(b));

  if (containers.length > 0) {
    const result = creep.withdraw(containers[0], RESOURCE_ENERGY);
    if (result === ERR_NOT_IN_RANGE) creep.moveTo(containers[0]);
    return true;
  }

  // No containers with energy — wait near spawn
  const spawns = creep.room.find(FIND_MY_SPAWNS);
  if (spawns.length > 0 && !creep.pos.isNearTo(spawns[0])) {
    creep.moveTo(spawns[0]);
  }
  return true;
}

// ── DELIVER: fill structures in priority order ──

function doDeliver(creep: Creep): boolean {
  // Carry empty → switch back to gather
  if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
    (creep.memory as HaulerMemory).task = HAULER_TASK.GATHER;
    return doGather(creep);
  }

  // 1. Fill spawn
  const spawn = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_SPAWN && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
  });
  if (spawn) {
    if (creep.transfer(spawn, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) creep.moveTo(spawn);
    return true;
  }

  // 2. Fill extensions
  const ext = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_EXTENSION && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
  });
  if (ext) {
    if (creep.transfer(ext, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) creep.moveTo(ext);
    return true;
  }

  // 3. Fill spawn overflow container (below 80%)
  const spawns = creep.room.find(FIND_MY_SPAWNS);
  if (spawns.length > 0) {
    const overflow = spawns[0].pos.findInRange(FIND_STRUCTURES, 3, {
      filter: s => s.structureType === STRUCTURE_CONTAINER &&
        (s as StructureContainer).store.getFreeCapacity(RESOURCE_ENERGY) > (s as StructureContainer).store.getCapacity(RESOURCE_ENERGY) * 0.2
    })[0];
    if (overflow) {
      if (creep.transfer(overflow, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) creep.moveTo(overflow);
      return true;
    }
  }

  // 4. Fill controller container (below 80%)
  const controller = creep.room.controller;
  if (controller) {
    const ctrlContainer = controller.pos.findInRange(FIND_STRUCTURES, 1, {
      filter: s => s.structureType === STRUCTURE_CONTAINER &&
        (s as StructureContainer).store.getFreeCapacity(RESOURCE_ENERGY) > (s as StructureContainer).store.getCapacity(RESOURCE_ENERGY) * 0.2
    })[0];
    if (ctrlContainer) {
      if (creep.transfer(ctrlContainer, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) creep.moveTo(ctrlContainer);
      return true;
    }
  }

  // Nowhere to deliver — switch to gather (even if carry isn't empty, to avoid loops)
  (creep.memory as HaulerMemory).task = HAULER_TASK.GATHER;
  return true;
}
