/**
 * roles/hauler.ts — Energy transport creep logic
 *
 * Moves energy from dropped resources and containers to spawns, extensions,
 * and towers. Lets harvesters focus on harvesting instead of walking.
 * At RCL 3 with extensions and towers, efficient logistics matters.
 *
 * STUCK DETECTION: tracks position across ticks. If the hauler hasn't moved
 * in STUCK_THRESHOLD ticks, it recalculates and picks a new target.
 */

import { trackHarvest } from '../telemetry';

/** Ticks without position change before declaring stuck */
const STUCK_THRESHOLD = 15;

interface HaulerMemory {
  role: 'hauler';
  hauling: boolean;
  /** Last (x,y) position for stuck detection */
  lastX?: number;
  lastY?: number;
  /** Ticks spent at current position */
  stuckTicks?: number;
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
    // Track position for stuck detection
    const dx = creep.pos.x;
    const dy = creep.pos.y;
    if (mem.lastX !== undefined && mem.lastX === dx && mem.lastY === dy) {
      mem.stuckTicks = (mem.stuckTicks || 0) + 1;
    } else {
      mem.stuckTicks = 0;
    }
    mem.lastX = dx;
    mem.lastY = dy;

    if ((mem.stuckTicks || 0) > STUCK_THRESHOLD) {
      mem.stuckTicks = 0;
      // Stuck while delivering — drop energy and go collect more.
      // A harvester or upgrader will use the dropped energy.
      creep.drop(RESOURCE_ENERGY);
      mem.hauling = true;
      return true;
    }

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
  // Track position for stuck detection
  const px = creep.pos.x;
  const py = creep.pos.y;

  // Check if we've moved since last tick
  if (mem.lastX !== undefined && mem.lastX === px && mem.lastY === py) {
    mem.stuckTicks = (mem.stuckTicks || 0) + 1;
  } else {
    mem.stuckTicks = 0;
  }
  mem.lastX = px;
  mem.lastY = py;

  if ((mem.stuckTicks || 0) > STUCK_THRESHOLD) {
    // Stuck! Reset targeting and try something completely different.
    mem.stuckTicks = 0;
    // Harvest directly from a source to get unstuck from looping
    const rescueSource = creep.pos.findClosestByPath(FIND_SOURCES);
    if (rescueSource) {
      const result = creep.harvest(rescueSource);
      if (result === ERR_NOT_IN_RANGE) {
        creep.moveTo(rescueSource, { visualizePathStyle: { stroke: '#ffaa00' } });
      } else if (result === OK) {
        trackHarvest(creep.room.name, creep.getActiveBodyparts(WORK) * 2);
      }
      return true;
    }
  }

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

  // If empty and no dropped energy or containers, help upgrade controller.
  // Harvesting from a source as a hauler makes no sense: haulers exist to
  // move energy that harvesters already harvested. If there's nothing to
  // move, haulers become temporary upgraders until energy appears.
  if (creep.room.controller) {
    if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
      creep.moveTo(creep.room.controller, { visualizePathStyle: { stroke: '#ffffff' } });
    }
    return true;
  }

  return false;
}
