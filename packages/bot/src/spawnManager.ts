/**
 * spawnManager.ts — Apocrypha Spawn Manager
 *
 * Uses bodyDesigner for per-role body comps based on RCL and energy.
 * Manages spawn queues with quota limits and spawn gates.
 *
 * Spawn gates:
 * - builder: only if overflow container ≥50% full AND construction sites exist, max 2
 * - upgrader: only if controller container is full, max 1
 * - survivor: only if 0 miners, max 2
 * - miner: max 2 (one per source)
 * - hauler: max 3 at RCL 3+, only if source containers exist
 */

import { getBody } from './bodyDesigner';
import { trackSpawnSpend } from './telemetry';

interface SpawnQuota {
  role: string;
  minimum: number;
  maximum: number;
}

/**
 * Get spawn quotas for a room based on RCL.
 */
function getQuotas(rcl: number): SpawnQuota[] {
  const quotas: SpawnQuota[] = [
    { role: 'miner',    minimum: 0, maximum: 2 },
    { role: 'survivor', minimum: 0, maximum: 2 },
    { role: 'hauler',   minimum: 0, maximum: 0 },
    { role: 'builder',  minimum: 0, maximum: 2 },
    { role: 'upgrader', minimum: 0, maximum: 1 },
  ];

  switch (rcl) {
    case 0:
    case 1:
      quotas[0] = { role: 'miner',    minimum: 2, maximum: 4 }; // walking miners at RCL 1
      quotas[1] = { role: 'survivor', minimum: 0, maximum: 2 };
      break;
    case 2:
      quotas[0] = { role: 'miner',    minimum: 2, maximum: 3 };
      quotas[2] = { role: 'hauler',   minimum: 1, maximum: 2 };
      quotas[3] = { role: 'builder',  minimum: 1, maximum: 2 };
      break;
    case 3:
      quotas[0] = { role: 'miner',    minimum: 2, maximum: 2 };
      quotas[2] = { role: 'hauler',   minimum: 2, maximum: 3 };
      quotas[3] = { role: 'builder',  minimum: 0, maximum: 2 };
      quotas[4] = { role: 'upgrader', minimum: 0, maximum: 1 };
      break;
    case 4:
    case 5:
      quotas[0] = { role: 'miner',    minimum: 2, maximum: 2 };
      quotas[2] = { role: 'hauler',   minimum: 2, maximum: 4 };
      quotas[3] = { role: 'builder',  minimum: 0, maximum: 2 };
      quotas[4] = { role: 'upgrader', minimum: 0, maximum: 1 };
      break;
    default:
      quotas[0] = { role: 'miner',    minimum: 2, maximum: 2 };
      quotas[2] = { role: 'hauler',   minimum: 3, maximum: 5 };
      quotas[3] = { role: 'builder',  minimum: 0, maximum: 2 };
      quotas[4] = { role: 'upgrader', minimum: 0, maximum: 2 };
  }

  return quotas;
}

/** Check spawn gate conditions for a role */
function spawnGate(role: string, room: Room): boolean {
  const spawns = room.find(FIND_MY_SPAWNS);
  if (spawns.length === 0) return false;

  // Survivor gate: only if 0 miners exist
  if (role === 'survivor') {
    const miners = room.find(FIND_MY_CREEPS).filter(c => c.memory.role === 'miner');
    return miners.length === 0;
  }

  // Builder gate: overflow container ≥50% full AND construction sites exist
  if (role === 'builder') {
    const sites = room.find(FIND_CONSTRUCTION_SITES);
    if (sites.length === 0) return false;
    const container = spawns[0].pos.findInRange(FIND_STRUCTURES, 3, {
      filter: s => s.structureType === STRUCTURE_CONTAINER
    })[0];
    if (!container) return false;
    const store = (container as StructureContainer).store;
    return store.getUsedCapacity(RESOURCE_ENERGY) >= store.getCapacity(RESOURCE_ENERGY) * 0.5;
  }

  // Upgrader gate: controller container is full
  if (role === 'upgrader') {
    const controller = room.controller;
    if (!controller) return false;
    const container = controller.pos.findInRange(FIND_STRUCTURES, 1, {
      filter: s => s.structureType === STRUCTURE_CONTAINER
    })[0];
    if (!container) return false;
    const store = (container as StructureContainer).store;
    return store.getFreeCapacity(RESOURCE_ENERGY) === 0;
  }

  // Hauler gate: source containers exist
  if (role === 'hauler') {
    const containers = room.find(FIND_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_CONTAINER
    });
    return containers.length > 0;
  }

  return true;
}

/**
 * Run spawn logic for one room. Call once per tick.
 */
export function runSpawnManager(room: Room): void {
  const spawns = room.find(FIND_MY_SPAWNS).filter(s => !s.spawning);
  if (spawns.length === 0) return;

  const rcl = room.controller?.level ?? 0;
  const quotas = getQuotas(rcl);

  // Count current creeps by role
  const creepCounts: Record<string, number> = {};
  for (const c of room.find(FIND_MY_CREEPS)) {
    const role = c.memory.role ?? 'unknown';
    creepCounts[role] = (creepCounts[role] || 0) + 1;
  }

  // Try each role in priority order
  for (const quota of quotas) {
    const current = creepCounts[quota.role] || 0;

    // Below minimum? Always try to spawn. At minimum but below max? Only if spawn gate passes.
    if (current >= quota.maximum) continue;
    if (current >= quota.minimum && !spawnGate(quota.role, room)) continue;

    // Get body for this role
    const body = getBody(quota.role, rcl, room.energyAvailable);
    if (!body || body.length === 0) continue;

    // Spawn
    const name = quota.role + '_' + Game.time;
    for (const spawn of spawns) {
      const result = spawn.spawnCreep(body, name, {
        memory: { role: quota.role, harvesting: true, building: false, upgrading: false, positioned: false }
      });
      if (result === OK) {
        const cost = body.reduce((sum, p) => sum + BODYPART_COST[p], 0);
        trackSpawnSpend(room.name, cost);
        console.log('[spawn] ' + name + ' (' + quota.role + ') body=' + body.join(',') + ' cost=' + cost + 'e');
        return;
      }
    }
  }
}
