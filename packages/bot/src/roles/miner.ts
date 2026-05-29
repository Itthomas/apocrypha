/**
 * roles/miner.ts — Static miner creep logic
 *
 * Stands on the container next to a source and harvests continuously.
 * When carry is full, transfers to the container below (one tick overhead).
 * When source is depleted, repairs the container and picks up dropped energy.
 * Never leaves its spot.
 */

import { trackHarvest } from '../telemetry';

interface MinerMemory {
  role: 'miner';
  sourceId?: Id<Source>;
  containerId?: Id<StructureContainer>;
  positioned: boolean;
}

function assignSource(creep: Creep): boolean {
  const mem = creep.memory as MinerMemory;
  const room = creep.room;
  const sources = room.find(FIND_SOURCES);
  const miners = room.find(FIND_MY_CREEPS).filter(c => c.memory.role === 'miner');

  const counts = new Map<string, number>();
  for (const s of sources) counts.set(s.id, 0);
  for (const m of miners) {
    if (m.id === creep.id) continue;
    const sid = (m.memory as MinerMemory).sourceId;
    if (sid) counts.set(sid, (counts.get(sid) || 0) + 1);
  }

  let best: Source | null = null;
  let bestCount = Infinity;
  for (const s of sources) {
    const c = counts.get(s.id) || 0;
    if (c < bestCount) {
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

  if (best) { mem.sourceId = best.id; return true; }
  return false;
}

export function run(creep: Creep): boolean {
  const mem = creep.memory as MinerMemory;

  if (!mem.sourceId && !assignSource(creep)) return false;

  const source = Game.getObjectById(mem.sourceId!);
  if (!source) { mem.sourceId = undefined; return false; }

  const container = mem.containerId ? Game.getObjectById(mem.containerId) : null;

  // Position on container
  if (!mem.positioned) {
    const target = container || source;
    if (!creep.pos.isEqualTo(target.pos)) { creep.moveTo(target); return true; }
    mem.positioned = true;
  }

  // Re-check position
  if (container && !creep.pos.isEqualTo(container.pos)) {
    creep.moveTo(container); mem.positioned = false; return true;
  }

  // Source depleted — repair container, pick up dropped energy
  if (source.energy === 0) {
    if (container && container.hits < container.hitsMax) {
      creep.repair(container);
    } else {
      const dropped = creep.pos.findInRange(FIND_DROPPED_RESOURCES, 1, {
        filter: r => r.resourceType === RESOURCE_ENERGY
      });
      if (dropped.length > 0) creep.pickup(dropped[0]);
    }
    return true;
  }

  // Harvest if carry has space
  if (creep.store.getFreeCapacity() > 0) {
    const result = creep.harvest(source);
    if (result === OK) trackHarvest(creep.room.name, creep.getActiveBodyparts(WORK) * 2);
    return true;
  }

  // Carry full — transfer to container below
  if (container) {
    creep.transfer(container, RESOURCE_ENERGY);
    return true;
  }

  return false;
}
