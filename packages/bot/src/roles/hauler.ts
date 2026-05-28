/**
 * roles/hauler.ts — Energy transport creep (pure carrier)
 *
 * Body: CARRY + MOVE only, no WORK parts.
 * Picks up energy from source containers and delivers to spawn/extensions/tower.
 * Can also pick up from dropped energy on the ground as fallback.
 * Gets fast when empty (empty CARRY generates 0 fatigue).
 */

interface HaulerMemory {
  role: 'hauler';
  delivering: boolean;
}

export function run(creep: Creep): boolean {
  const mem = creep.memory as HaulerMemory;

  if (creep.store.getFreeCapacity() === 0) mem.delivering = true;
  if (creep.store.getUsedCapacity() === 0) mem.delivering = false;

  // DELIVER
  if (mem.delivering) {
    // Priority: spawn energy, then extensions, then tower, then spawn overflow container
    const spawn = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_SPAWN && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
    });
    if (spawn) {
      if (creep.transfer(spawn, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) creep.moveTo(spawn);
      return true;
    }

    const ext = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_EXTENSION && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
    });
    if (ext) {
      if (creep.transfer(ext, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) creep.moveTo(ext);
      return true;
    }

    const tower = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_TOWER && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
    });
    if (tower) {
      if (creep.transfer(tower, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) creep.moveTo(tower);
      return true;
    }

    // Fallback: spawn overflow container (near spawn, for builders/upgraders)
    const spawnObj = creep.room.find(FIND_MY_SPAWNS)[0];
    if (spawnObj) {
      const overflowContainer = spawnObj.pos.findInRange(FIND_STRUCTURES, 3, {
        filter: s => s.structureType === STRUCTURE_CONTAINER && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
      })[0];
      if (overflowContainer) {
        if (creep.transfer(overflowContainer, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) creep.moveTo(overflowContainer);
        return true;
      }
    }

    return false;
  }

  // PICK UP — from source containers, then dropped energy, then any container
  const sourceContainer = creep.pos.findClosestByPath(FIND_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_CONTAINER && s.store.getUsedCapacity(RESOURCE_ENERGY) >= 100
  });
  if (sourceContainer) {
    if (creep.withdraw(sourceContainer, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) creep.moveTo(sourceContainer);
    return true;
  }

  // Fallback: dropped energy
  const dropped = creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
    filter: r => r.resourceType === RESOURCE_ENERGY && r.amount >= 100
  });
  if (dropped) {
    if (creep.pickup(dropped) === ERR_NOT_IN_RANGE) creep.moveTo(dropped);
    return true;
  }

  return false;
}
