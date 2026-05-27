/**
 * roles/builder.ts — Construction and repair creep logic
 *
 * Builds construction sites and repairs damaged structures.
 * Withdraws energy from spawns/extensions, then seeks build/repair targets.
 */

interface BuilderMemory {
  role: 'builder';
  building: boolean;
  targetId?: Id<ConstructionSite | Structure>;
}

export function run(creep: Creep): boolean {
  const mem = creep.memory as BuilderMemory;

  // State transition
  if (creep.store.getFreeCapacity() === 0) {
    mem.building = true;
  }
  if (creep.store.getUsedCapacity() === 0) {
    mem.building = false;
    mem.targetId = undefined;
  }

  // BUILD
  if (mem.building) {
    // Priority: construction sites (by progress), then repairs (lowest hp first)
    let target: ConstructionSite | Structure | null = null;

    if (mem.targetId) {
      target = Game.getObjectById(mem.targetId);
    }

    if (!target) {
      // Find nearest construction site
      target = creep.pos.findClosestByPath(FIND_CONSTRUCTION_SITES);
      if (!target) {
        // Find structures below 50% hp
        target = creep.pos.findClosestByPath(FIND_STRUCTURES, {
          filter: s => s.hits < s.hitsMax * 0.5
        });
      }
    }

    if (!target) {
      // Nothing to build/repair — fall back to upgrading
      if (creep.room.controller) {
        if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
          creep.moveTo(creep.room.controller);
        }
      }
      return true;
    }

    mem.targetId = target.id;

    let result: ScreepsReturnCode;
    if (target instanceof ConstructionSite) {
      result = creep.build(target);
    } else {
      result = creep.repair(target);
    }

    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(target, { visualizePathStyle: { stroke: '#00ff00' } });
    } else if (result === OK) {
      // Clear target if finished
      if ((target instanceof ConstructionSite && !Game.getObjectById(target.id)) ||
          (target instanceof Structure && target.hits >= target.hitsMax)) {
        mem.targetId = undefined;
      }
    }

    return true;
  }

  // WITHDRAW energy
  const spawnOrExt = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
    filter: s =>
      (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) &&
      s.store.getUsedCapacity(RESOURCE_ENERGY) > 0
  });

  if (spawnOrExt) {
    if (creep.withdraw(spawnOrExt, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
      creep.moveTo(spawnOrExt);
    }
    return true;
  }

  // Emergency: no stored energy — harvest from a source to bootstrap the colony
  const source = creep.pos.findClosestByPath(FIND_SOURCES);
  if (source) {
    if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
      creep.moveTo(source, { visualizePathStyle: { stroke: '#ffaa00' } });
    }
    return true;
  }

  // No energy available, idle
  return false;
}
