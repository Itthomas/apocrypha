/**
 * roles/builder.ts — Construction creep
 *
 * State machine:
 *   GATHER: withdraw from spawn overflow container until carry is full
 *   BUILD: build nearest construction site or repair nearest damaged structure
 *
 * Never harvests from sources — only pulls from the overflow container.
 * Builds nearest construction site. Repairs structures below 50% hp.
 * Ramparts use an RCL-gated artificial health threshold instead of their
 * astronomical actual max health.
 * Switches between GATHER and BUILD as carry empties/fills.
 */

import { getRampartRepairThreshold } from '../tower';

enum BUILDER_TASK {
  GATHER = 0,
  BUILD = 1,
}

interface BuilderMemory {
  role: 'builder';
  task: BUILDER_TASK;
}

export function run(creep: Creep): boolean {
  const mem = creep.memory as BuilderMemory;
  if (mem.task === undefined) mem.task = BUILDER_TASK.GATHER;

  // Carry empty → GATHER
  if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0 && mem.task !== BUILDER_TASK.GATHER) {
    mem.task = BUILDER_TASK.GATHER;
  }
  // Carry full → BUILD
  if (creep.store.getFreeCapacity() === 0 && mem.task !== BUILDER_TASK.BUILD) {
    mem.task = BUILDER_TASK.BUILD;
  }

  if (mem.task === BUILDER_TASK.GATHER) {
    return doGather(creep);
  }
  return doBuildOrRepair(creep);
}

// ── GATHER: withdraw from spawn overflow container ──

function doGather(creep: Creep): boolean {
  if (creep.store.getFreeCapacity() === 0) {
    (creep.memory as BuilderMemory).task = BUILDER_TASK.BUILD;
    return doBuildOrRepair(creep);
  }

  // Find spawn overflow container
  const spawns = creep.room.find(FIND_MY_SPAWNS);
  if (spawns.length > 0) {
    const container = spawns[0].pos.findInRange(FIND_STRUCTURES, 3, {
      filter: s => s.structureType === STRUCTURE_CONTAINER
    })[0];
    if (container) {
      if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) creep.moveTo(container);
      return true;
    }
  }

  // No overflow container — idle near spawn
  return false;
}

// ── BUILD: build nearest site or repair nearest damaged structure ──

function doBuildOrRepair(creep: Creep): boolean {
  if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
    (creep.memory as BuilderMemory).task = BUILDER_TASK.GATHER;
    return doGather(creep);
  }

  // 1. Repair nearest damaged structure below 50% health.
  //    Ramparts use the RCL-gated artificial threshold (e.g. 20k at RCL 5)
  //    instead of their actual max health. Walls are ignored entirely.
  const rcl = creep.room.controller?.level ?? 0;
  const rampartThreshold = getRampartRepairThreshold(rcl);
  const damaged = creep.pos.findClosestByPath(FIND_STRUCTURES, {
    filter: s => {
      if (s.structureType === STRUCTURE_WALL) return false;

      if (s.structureType === STRUCTURE_RAMPART) {
        if (rampartThreshold === 0) return false;
        const effectiveMax = Math.min(s.hitsMax, rampartThreshold);
        return s.hits < effectiveMax * 0.5;
      }

      return s.hits < s.hitsMax * 0.5;
    }
  });
  if (damaged) {
    const result = creep.repair(damaged);
    if (result === ERR_NOT_IN_RANGE) creep.moveTo(damaged);
    return true;
  }

  // 2. Build nearest construction site
  const site = creep.pos.findClosestByPath(FIND_CONSTRUCTION_SITES);
  if (site) {
    const result = creep.build(site);
    if (result === ERR_NOT_IN_RANGE) creep.moveTo(site);
    return true;
  }

  // Nothing to build or repair — go idle (don't switch to harvest)
  return false;
}
