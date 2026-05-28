/**
 * roles/miner.ts — Static miner creep logic
 *
 * Moves to a source container, stands on it, and harvests forever.
 * Transfers energy to the container below it when carry fills.
 * Never leaves its spot until death.
 */

import { trackHarvest } from '../telemetry';

interface MinerMemory {
  role: 'miner';
  sourceId?: Id<Source>;
  containerId?: Id<StructureContainer>;
  positioned: boolean;
}

/** Assign a source and its adjacent container to this miner */
function assignSource(creep: Creep): boolean {
  const mem = creep.memory as MinerMemory;
  const room = creep.room;

  // Find sources and count miners per source
  const sources = room.find(FIND_SOURCES);
  const miners = room.find(FIND_MY_CREEPS).filter(c => c.memory.role === 'miner');

  // Count miners per source
  const counts = new Map<string, number>();
  for (const s of sources) counts.set(s.id, 0);
  for (const m of miners) {
    if (m.id === creep.id) continue;
    const sid = (m.memory as MinerMemory).sourceId;
    if (sid) counts.set(sid, (counts.get(sid) || 0) + 1);
  }

  // Pick the least-claimed source that has a container
  let best: Source | null = null;
  let bestCount = Infinity;
  for (const s of sources) {
    const c = counts.get(s.id) || 0;
    if (c < bestCount) {
      // Check if there's a container adjacent to this source
      const containers = s.pos.findInRange(FIND_STRUCTURES, 1, {
        filter: st => st.structureType === STRUCTURE_CONTAINER
      });
      if (containers.length > 0) {
        bestCount = c;
        best = s;
        (mem as MinerMemory).containerId = (containers[0] as StructureContainer).id;
      }
    }
  }

  if (best) {
    mem.sourceId = best.id;
    return true;
  }

  // No container found — assign to least-claimed source anyway, miner will harvest walking-style until container exists
  for (const s of sources) {
    const c = counts.get(s.id) || 0;
    if (c < bestCount) { bestCount = c; best = s; }
  }
  if (best) {
    mem.sourceId = best.id;
    return true;
  }

  return false;
}

export function run(creep: Creep): boolean {
  const mem = creep.memory as MinerMemory;

  // Assign source on first tick
  if (!mem.sourceId) {
    if (!assignSource(creep)) return false;
  }

  const source = Game.getObjectById(mem.sourceId!);
  if (!source) {
    mem.sourceId = undefined;
    return false;
  }

  const container = mem.containerId ? Game.getObjectById(mem.containerId) : null;

  // Phase 1: Position on the container (or near source if no container)
  if (!mem.positioned) {
    const target = container || source;
    if (!creep.pos.isNearTo(target)) {
      creep.moveTo(target);
      return true;
    }
    mem.positioned = true;
  }

  // Verify we're still on/near the container — recorrect if not
  if (container && !creep.pos.isEqualTo(container.pos)) {
    creep.moveTo(container);
    mem.positioned = false;
    return true;
  }
  if (!container && !creep.pos.isNearTo(source)) {
    creep.moveTo(source);
    mem.positioned = false;
    return true;
  }

  // Phase 2: Harvest or transfer
  if (creep.store.getFreeCapacity() > 0) {
    // Harvest from source
    const result = creep.harvest(source);
    if (result === OK) {
      trackHarvest(creep.room.name, creep.getActiveBodyparts(WORK) * 2);
    }
    return true;
  }

  // Carry is full — transfer to container (if exists), else deliver to spawn
  if (container && container.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
    creep.transfer(container, RESOURCE_ENERGY);
    return true;
  }

  // No container or container full — self-deliver to spawn/extensions as fallback
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

  return false;
}
