/**
 * roles/harvester.ts — Energy harvester creep logic
 *
 * Harvests energy from the nearest assigned source and delivers
 * to spawn or extensions (acting as self-hauler at low RCL).
 * At higher RCL, harvesters focus on harvesting and haulers handle transport.
 */

import { trackHarvest } from '../telemetry';

/** Memory shape for harvester creeps */
interface HarvesterMemory {
  role: 'harvester';
  sourceId?: Id<Source>;
  harvesting: boolean;
}

/**
 * Assign a source to this harvester if not already assigned.
 */
function assignSource(creep: Creep): Id<Source> | null {
  const room = creep.room;
  const sources = room.find(FIND_SOURCES);

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
    // Priority: spawns/extensions that need energy, then controller at low RCL
    const target = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
      filter: s =>
        (s.structureType === STRUCTURE_SPAWN ||
         s.structureType === STRUCTURE_EXTENSION) &&
        s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
    });

    if (target) {
      if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
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
    creep.moveTo(source, { visualizePathStyle: { stroke: '#ffaa00' } });
  } else if (result === OK) {
    trackHarvest(creep.room.name, creep.getActiveBodyparts(WORK) * 2);
  }

  return true;
}
