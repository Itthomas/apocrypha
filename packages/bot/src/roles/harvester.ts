/**
 * roles/harvester.ts — Energy harvester creep logic
 *
 * Harvests energy from the nearest assigned source and delivers
 * to spawn or extensions (acting as self-hauler at low RCL).
 * At higher RCL, harvesters focus on harvesting and haulers handle transport.
 */

import { trackHarvest, trackCreepHarvest, trackDelivery } from '../telemetry';

/** Memory shape for harvester creeps */
interface HarvesterMemory {
  role: 'harvester';
  sourceId?: Id<Source>;
  harvesting: boolean;
}

/**
 * Check whether a source has at least one walkable adjacent tile.
 * A source surrounded entirely by walls is unreachable.
 */
function isSourceReachable(source: Source): boolean {
  const terrain = source.room.getTerrain();
  const { x, y } = source.pos;
  return (
    terrain.get(x + 1, y) !== TERRAIN_MASK_WALL ||
    terrain.get(x - 1, y) !== TERRAIN_MASK_WALL ||
    terrain.get(x, y + 1) !== TERRAIN_MASK_WALL ||
    terrain.get(x, y - 1) !== TERRAIN_MASK_WALL
  );
}

/**
 * Assign a source to this harvester if not already assigned.
 * Only considers sources with at least one walkable adjacent tile.
 */
function assignSource(creep: Creep): Id<Source> | null {
  const room = creep.room;
  const sources = room.find(FIND_SOURCES).filter(isSourceReachable);

  if (sources.length === 0) return null;

  // Count harvesters per source, pick least-claimed
  const harvesters = room.find(FIND_MY_CREEPS).filter(c => c.memory.role === 'harvester');
  const counts = new Map<string, number>();
  for (const s of sources) counts.set(s.id, 0);
  for (const h of harvesters) {
    const sid = (h.memory as HarvesterMemory).sourceId;
    if (sid) counts.set(sid, (counts.get(sid) || 0) + 1);
  }

  let best: Source | null = null;
  let bestCount = Infinity;
  for (const s of sources) {
    const c = counts.get(s.id) || 0;
    if (c < bestCount) {
      bestCount = c;
      best = s;
    }
  }

  return best?.id ?? null;
}

/**
 * Main harvester tick. Returns true if the creep acted.
 */
export function run(creep: Creep): boolean {
  const mem = creep.memory as HarvesterMemory;

  // State transition: full → deliver, empty → harvest
  if (creep.store.getFreeCapacity() === 0) {
    mem.harvesting = false;
  }
  if (creep.store.getUsedCapacity() === 0) {
    mem.harvesting = true;
  }

  // DELIVER
  if (!mem.harvesting) {
    // Check if haulers exist — if so, drop energy and get back to harvesting
    const haulers = creep.room.find(FIND_MY_CREEPS).filter(
      c => (c.memory as { role?: string }).role === 'hauler'
    );

    // Only drop for haulers if spawn/extensions are mostly full (> 50%)
    // Otherwise self-deliver to prevent energy starvation
    if (haulers.length > 0) {
      const hungryStructures = creep.room.find(FIND_MY_STRUCTURES, {
        filter: s =>
          (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) &&
          s.store.getUsedCapacity(RESOURCE_ENERGY) < s.store.getCapacity(RESOURCE_ENERGY) * 0.5
      });

      if (hungryStructures.length === 0) {
        // Infrastructure is well-fed: drop for haulers, return to source
        creep.drop(RESOURCE_ENERGY);
        mem.harvesting = true;
        return true;
      }
      // Fall through: spawn/extensions need energy, self-deliver below
    }

    // No haulers (or spawn needs energy): self-deliver to spawn/extensions
    const target = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
      filter: s =>
        (s.structureType === STRUCTURE_SPAWN ||
         s.structureType === STRUCTURE_EXTENSION) &&
        s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
    });

    if (target) {
      const result = creep.transfer(target, RESOURCE_ENERGY);
      if (result === OK) {
        trackDelivery(creep, creep.getActiveBodyparts(CARRY) * 50);
      } else if (result === ERR_NOT_IN_RANGE) {
        creep.moveTo(target, { visualizePathStyle: { stroke: '#ffaa00' } });
      }
      return true;
    }

    // Fallback: upgrade controller if spawns are full
    if (creep.room.controller) {
      if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
        creep.moveTo(creep.room.controller, { visualizePathStyle: { stroke: '#ffffff' } });
      }
      return true;
    }

    return false;
  }

  // HARVEST
  if (!mem.sourceId) {
    mem.sourceId = assignSource(creep);
  }

  const source = Game.getObjectById(mem.sourceId!);
  if (!source) {
    mem.sourceId = assignSource(creep);
    return true;
  }

  const result = creep.harvest(source);
  if (result === ERR_NOT_IN_RANGE) {
    const moveResult = creep.moveTo(source, { visualizePathStyle: { stroke: '#ffaa00' } });
    if (moveResult === ERR_NO_PATH) {
      // Source may be walled off — reassign
      mem.sourceId = undefined;
    }
  } else if (result === OK) {
    const amount = creep.getActiveBodyparts(WORK) * 2;
    trackHarvest(creep.room.name, amount);
    trackCreepHarvest(creep, amount);
  }

  return true;
}
