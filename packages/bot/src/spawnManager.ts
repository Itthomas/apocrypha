/**
 * spawnManager.ts — Apocrypha Spawn Manager
 *
 * Decides what to spawn based on room state, energy, and current creep counts.
 * Implements a phase-based bootstrap: harvesters → builders → upgraders → haulers.
 */

import { trackSpawnSpend } from './telemetry';

/** Role priority order for spawning. Lower index = spawn first. */
type CreepRole = 'harvester' | 'builder' | 'upgrader' | 'hauler';

/** Desired creep composition per RCL phase */
interface SpawnQuota {
  role: CreepRole;
  /** Body parts as array of body part constants */
  body: BodyPartConstant[];
  /** Minimum number of this role to maintain */
  minimum: number;
  /** Maximum (hard cap) */
  maximum: number;
}

/**
 * Get spawn quota for a room based on its RCL and energy capacity.
 * Returns role list sorted by spawn priority.
 */
export function getSpawnQuotas(room: Room): SpawnQuota[] {
  const rcl = room.controller?.level ?? 0;
  const energyCap = room.energyCapacityAvailable;
  const energyAvail = room.energyAvailable;

  // Simple body builder: fill WORK/CARRY/MOVE in equal parts up to energy cap
  const buildBody = (work: number): BodyPartConstant[] => {
    const parts: BodyPartConstant[] = [];
    for (let i = 0; i < work; i++) parts.push(WORK);
    for (let i = 0; i < work; i++) parts.push(CARRY);
    for (let i = 0; i < work; i++) parts.push(MOVE);
    return parts;
  };

  // Early game: WORK, CARRY, MOVE triples
  const tiers = Math.min(Math.floor(energyAvail / 150), Math.floor(energyCap / 150));

  const quotas: SpawnQuota[] = [];

  switch (rcl) {
    case 0:
    case 1:
      // Just harvesters — they self-haul to spawn
      quotas.push({ role: 'harvester', body: buildBody(Math.min(tiers, 2)), minimum: 2, maximum: 4 });
      break;

    case 2:
      // Harvesters + builders + one upgrader
      quotas.push({ role: 'harvester', body: buildBody(Math.min(tiers, 3)), minimum: 2, maximum: 4 });
      quotas.push({ role: 'builder', body: buildBody(Math.min(tiers, 3)), minimum: 1, maximum: 3 });
      quotas.push({ role: 'upgrader', body: buildBody(Math.min(tiers, 2)), minimum: 1, maximum: 2 });
      break;

    case 3:
      // Extensions online — bigger bodies, add haulers
      quotas.push({ role: 'harvester', body: buildBody(Math.min(tiers, 4)), minimum: 2, maximum: 4 });
      quotas.push({ role: 'hauler', body: buildBody(Math.min(tiers, 3)), minimum: 1, maximum: 3 });
      quotas.push({ role: 'builder', body: buildBody(Math.min(tiers, 3)), minimum: 1, maximum: 2 });
      quotas.push({ role: 'upgrader', body: buildBody(Math.min(tiers, 4)), minimum: 1, maximum: 3 });
      break;

    case 4:
    case 5:
      // Storage + towers online
      quotas.push({ role: 'harvester', body: buildBody(Math.min(tiers, 5)), minimum: 2, maximum: 4 });
      quotas.push({ role: 'hauler', body: buildBody(Math.min(tiers, 4)), minimum: 2, maximum: 4 });
      quotas.push({ role: 'builder', body: buildBody(Math.min(tiers, 4)), minimum: 1, maximum: 2 });
      quotas.push({ role: 'upgrader', body: buildBody(Math.min(tiers, 5)), minimum: 1, maximum: 3 });
      break;

    case 6:
    case 7:
    case 8:
      // Late game — big bodies
      quotas.push({ role: 'harvester', body: buildBody(Math.min(tiers, 6)), minimum: 2, maximum: 5 });
      quotas.push({ role: 'hauler', body: buildBody(Math.min(tiers, 5)), minimum: 2, maximum: 5 });
      quotas.push({ role: 'builder', body: buildBody(Math.min(tiers, 4)), minimum: 1, maximum: 2 });
      quotas.push({ role: 'upgrader', body: buildBody(Math.min(tiers, 6)), minimum: 1, maximum: 4 });
      break;
  }

  return quotas;
}

/**
 * Run spawn logic for one room. Call once per tick.
 */
export function runSpawnManager(room: Room): void {
  const spawns = room.find(FIND_MY_SPAWNS).filter(s => !s.spawning);
  if (spawns.length === 0) return;

  const quotas = getSpawnQuotas(room);

  // Count current creeps by role
  const creepCounts: Record<string, number> = {};
  const creeps = room.find(FIND_MY_CREEPS);
  for (const c of creeps) {
    const role = c.memory.role ?? 'unknown';
    creepCounts[role] = (creepCounts[role] || 0) + 1;
  }

  // Try to spawn in priority order
  for (const quota of quotas) {
    const current = creepCounts[quota.role] || 0;

    // Already at minimum? Skip if we're at the hard cap
    if (current >= quota.maximum) continue;

    // Can we afford it?
    const cost = quota.body.reduce((sum, part) => sum + BODYPART_COST[part], 0);
    if (room.energyAvailable < cost) continue;

    // Generate a name
    const name = `${quota.role}_${Game.time}`;

    // Try each spawn
    for (const spawn of spawns) {
      const result = spawn.spawnCreep(quota.body, name, {
        memory: { role: quota.role, harvesting: true, building: false, upgrading: false }
      });

      if (result === OK) {
        trackSpawnSpend(room.name, cost);
        console.log(`[spawn] ${name} (${quota.role}) — ${cost}e`);
        return; // One spawn per tick
      }
    }
  }
}
