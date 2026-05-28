/**
 * roles/survivor.ts — Emergency bootstrap creep
 *
 * Activated only when colony has 0 miners.
 * Generalist: harvests energy from sources, delivers to spawn.
 * Keeps the colony alive until proper miners can be spawned.
 */

import { trackHarvest } from '../telemetry';

interface SurvivorMemory {
  role: 'survivor';
  harvesting: boolean;
}

export function run(creep: Creep): boolean {
  const mem = creep.memory as SurvivorMemory;

  if (creep.store.getFreeCapacity() === 0) mem.harvesting = false;
  if (creep.store.getUsedCapacity() === 0) mem.harvesting = true;

  // DELIVER
  if (!mem.harvesting) {
    const target = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
      filter: s =>
        (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) &&
        s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
    });
    if (target) {
      if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(target);
      }
      return true;
    }
    // Nothing to deliver to — idle
    return false;
  }

  // HARVEST
  const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
  if (!source) return false;

  const result = creep.harvest(source);
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(source);
  } else if (result === OK) {
    trackHarvest(creep.room.name, creep.getActiveBodyparts(WORK) * 2);
  }

  return true;
}
