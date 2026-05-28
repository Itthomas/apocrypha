/**
 * roles/upgrader.ts — Room controller upgrader creep logic
 *
 * Withdraws energy from spawns/containers and pumps it into the room controller.
 * Active only when there's surplus energy or the room is between build phases.
 */

import { trackHarvest } from '../telemetry';

interface UpgraderMemory {
  role: 'upgrader';
  upgrading: boolean;
}

export function run(creep: Creep): boolean {
  const mem = creep.memory as UpgraderMemory;

  // State transition
  if (creep.store.getFreeCapacity() === 0) {
    mem.upgrading = true;
  }
  if (creep.store.getUsedCapacity() === 0) {
    mem.upgrading = false;
  }

  // UPGRADE
  if (mem.upgrading) {
    const controller = creep.room.controller;
    if (controller) {
      const result = creep.upgradeController(controller);
      if (result === ERR_NOT_IN_RANGE) {
        creep.moveTo(controller, { visualizePathStyle: { stroke: '#ffffff' } });
      }
      return true;
    }
    return false;
  }

  // WITHDRAW
  // Pull from spawns first, then extensions, then containers, then dropped energy
  let target: StructureSpawn | StructureExtension | StructureContainer | Resource | null = null;

  // Nearest spawn/extension with energy
  const spawnOrExt = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
    filter: s =>
      (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) &&
      s.store.getUsedCapacity(RESOURCE_ENERGY) > 0
  });
  if (spawnOrExt) {
    target = spawnOrExt as StructureSpawn | StructureExtension;
  }

  // Fallback: container with energy
  if (!target) {
    const container = creep.pos.findClosestByPath(FIND_STRUCTURES, {
      filter: s =>
        s.structureType === STRUCTURE_CONTAINER &&
        (s as StructureContainer).store.getUsedCapacity(RESOURCE_ENERGY) > 0
    });
    if (container) target = container as StructureContainer;
  }

  // Fallback: dropped energy on the ground
  if (!target) {
    const dropped = creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
      filter: r => r.resourceType === RESOURCE_ENERGY && r.amount >= 50
    });
    if (dropped) target = dropped;
  }

  if (!target) {
    // Emergency: no stored or dropped energy — harvest from a source
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

    // Nothing at all — idle near controller
    if (creep.room.controller) {
      creep.moveTo(creep.room.controller);
    }
    return false;
  }

  if (target instanceof Resource) {
    if (creep.pickup(target) === ERR_NOT_IN_RANGE) {
      creep.moveTo(target);
    }
  } else {
    if (creep.withdraw(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
      creep.moveTo(target);
    }
  }

  return true;
}
