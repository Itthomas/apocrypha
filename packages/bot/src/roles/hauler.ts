/**
 * roles/hauler.ts — Energy transport creep logic
 *
 * Moves energy from dropped resources and containers to spawns, extensions,
 * and towers. Lets harvesters focus on harvesting instead of walking.
 * At RCL 3 with extensions and towers, efficient logistics matters.
 */

import { trackHarvest } from '../telemetry';

interface HaulerMemory {
  role: 'hauler';
  hauling: boolean;
}

export function run(creep: Creep): boolean {
  const mem = creep.memory as HaulerMemory;

  // State transition
  if (creep.store.getFreeCapacity() === 0) {
    mem.hauling = false;
  }
  if (creep.store.getUsedCapacity() === 0) {
    mem.hauling = true;
  }

  // DELIVER
  if (!mem.hauling) {
    // Priority: spawns, then extensions, then towers
    const target = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
      filter: s =>
        (s.structureType === STRUCTURE_SPAWN ||
         s.structureType === STRUCTURE_EXTENSION ||
         s.structureType === STRUCTURE_TOWER) &&
        s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
    });

    if (target) {
      if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(target, { visualizePathStyle: { stroke: '#ffaa00' } });
      }
      return true;
    }

    // Everything full — upgrade controller as energy sink
    if (creep.room.controller) {
      if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
        creep.moveTo(creep.room.controller, { visualizePathStyle: { stroke: '#ffffff' } });
      }
      return true;
    }

    return false;
  }

  // PICKUP / WITHDRAW
  // Priority: dropped energy on the ground, then containers with energy
  const dropped = creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
    filter: r => r.resourceType === RESOURCE_ENERGY && r.amount >= 50
  });

  if (dropped) {
    if (creep.pickup(dropped) === ERR_NOT_IN_RANGE) {
      creep.moveTo(dropped, { visualizePathStyle: { stroke: '#ffaa00' } });
    }
    return true;
  }

  // Fallback: withdraw from a container
  const container = creep.pos.findClosestByPath(FIND_STRUCTURES, {
    filter: s =>
      s.structureType === STRUCTURE_CONTAINER &&
      (s as StructureContainer).store.getUsedCapacity(RESOURCE_ENERGY) > 0
  });

  if (container) {
    if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
      creep.moveTo(container, { visualizePathStyle: { stroke: '#ffaa00' } });
    }
    return true;
  }

  // Nothing to haul — help build construction sites to speed recovery
  const site = creep.pos.findClosestByPath(FIND_CONSTRUCTION_SITES);
  if (site && creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
    if (creep.build(site) === ERR_NOT_IN_RANGE) {
      creep.moveTo(site, { visualizePathStyle: { stroke: '#00ff00' } });
    }
    return true;
  }

  // If empty and no dropped energy, harvest from a source to get energy for building
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
