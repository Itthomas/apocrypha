/**
 * roles/builder.ts — Construction and repair creep logic
 *
 * Builds construction sites and repairs damaged structures.
 * Withdraws energy from spawns/extensions, then seeks build/repair targets.
 *
 * ENERGY FLOOR: if room energy is below 300, the builder refuses to build
 * and instead upgrades the controller (or harvests if empty). This prevents
 * builders from starving the spawn queue by consuming energy for construction
 * while the colony can't afford to spawn new creeps.
 */

import { trackHarvest, trackBuild, trackRepair, trackUpgrade } from '../telemetry';

/** Minimum room energy before builders are allowed to build */
const BUILD_ENERGY_FLOOR = 300;

interface BuilderMemory {
  role: 'builder';
  building: boolean;
  targetId?: Id<ConstructionSite | Structure>;
  /** Ticks since last position change (stuck detection) */
  stuckTicks?: number;
  lastPos?: { x: number; y: number };
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
    // ENERGY FLOOR: refuse to build when room energy is below threshold.
    // Building costs energy per WORK part per tick. At low energy levels
    // this starves the spawn queue. Instead, upgrade the controller.
    if (creep.room.energyAvailable < BUILD_ENERGY_FLOOR) {
      if (creep.room.controller) {
        if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
          creep.moveTo(creep.room.controller, { visualizePathStyle: { stroke: '#ffffff' } });
        }
      }
      return true;
    }

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
          creep.moveTo(creep.room.controller, { visualizePathStyle: { stroke: '#ffffff' } });
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
      const workParts = creep.getActiveBodyparts(WORK);
      if (target instanceof ConstructionSite) {
        trackBuild(creep, workParts * 5);
      } else {
        trackRepair(creep, workParts);
      }
      // Clear target if finished
      if ((target instanceof ConstructionSite && !Game.getObjectById(target.id)) ||
          (target instanceof Structure && target.hits >= target.hitsMax)) {
        mem.targetId = undefined;
      }
    }

    return true;
  }

  // WITHDRAW energy — but only from spawn/extensions that have meaningful amounts.
  // Skip nearly-empty structures to avoid draining energy that should accumulate for spawning.
  const spawnOrExt = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
    filter: s =>
      (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) &&
      s.store.getUsedCapacity(RESOURCE_ENERGY) >= 50
  });

  if (spawnOrExt) {
    if (creep.withdraw(spawnOrExt, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
      creep.moveTo(spawnOrExt);
    }
    return true;
  }

  // No meaningful stored energy — upgrade controller until energy builds up
  if (creep.room.controller) {
    if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
      creep.moveTo(creep.room.controller, { visualizePathStyle: { stroke: '#ffffff' } });
    }
    return true;
  }

  // No controller somehow — harvest to at least do something
  const source = creep.pos.findClosestByPath(FIND_SOURCES);
  if (source) {
    const result = creep.harvest(source);
    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(source, { visualizePathStyle: { stroke: '#ffaa00' } });
    } else if (result === OK) {
      trackHarvest(creep.room.name, creep.getActiveBodyparts(WORK) * 2);
    }
    return true;
  }

  return false;
}
