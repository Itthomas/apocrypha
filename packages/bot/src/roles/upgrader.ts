/**
 * roles/upgrader.ts — Controller upgrade specialist
 *
 * Heavy WORK body, pulls from controller container only.
 * Spawns only when controller container is full (surplus energy).
 * Max 1 upgrader alive at a time.
 * Controller upgrade is the lowest energy priority.
 */

interface UpgraderMemory {
  role: 'upgrader';
  upgrading: boolean;
}

export function run(creep: Creep): boolean {
  const mem = creep.memory as UpgraderMemory;

  if (creep.store.getFreeCapacity() === 0) mem.upgrading = true;
  if (creep.store.getUsedCapacity() === 0) mem.upgrading = false;

  // UPGRADE
  if (mem.upgrading) {
    const controller = creep.room.controller;
    if (controller) {
      const result = creep.upgradeController(controller);
      if (result === ERR_NOT_IN_RANGE) {
        creep.moveTo(controller);
      }
      return true;
    }
    return false;
  }

  // WITHDRAW from controller container
  const controller = creep.room.controller;
  if (controller) {
    const container = controller.pos.findInRange(FIND_STRUCTURES, 1, {
      filter: s => s.structureType === STRUCTURE_CONTAINER
    })[0];
    if (container && (container as StructureContainer).store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
      if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(container);
      }
      return true;
    }
    // No container yet — wait at controller
    creep.moveTo(controller);
  }

  return false;
}
