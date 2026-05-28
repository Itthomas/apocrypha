/**
 * telemetry/index.ts — Apocrypha Telemetry Module
 *
 * Writes structured colony stats to Memory.stats every STATS_INTERVAL ticks.
 * This is the bridge between the running bot and the agent's MCP monitoring.
 */

import type { ColonyStats, CreepCensus, RoomEnergyStats, RoomStats } from './types';
import { STATS_INTERVAL } from './types';

/** Accumulated harvest totals (reset each stats window) */
const harvestWindow: Record<string, number> = {};

/** Accumulated spawn spend totals */
const spendWindow: Record<string, number> = {};

/**
 * Track energy harvested by a creep. Call from harvester role.
 */
export function trackHarvest(roomName: string, amount: number): void {
  harvestWindow[roomName] = (harvestWindow[roomName] || 0) + amount;
}

/**
 * Track energy spent on spawning. Call from spawn manager.
 */
export function trackSpawnSpend(roomName: string, amount: number): void {
  spendWindow[roomName] = (spendWindow[roomName] || 0) + amount;
}

/**
 * Build creep census by role for a room.
 */
function getCreepCensus(room: Room): CreepCensus {
  const byRole: Record<string, number> = {};
  const creeps = room.find(FIND_MY_CREEPS);
  for (const creep of creeps) {
    const role = creep.memory.role ?? 'unknown';
    byRole[role] = (byRole[role] || 0) + 1;
  }
  return { total: creeps.length, byRole };
}

/**
 * Collect energy stats for a room.
 */
function getRoomEnergy(room: Room): RoomEnergyStats {
  const stored = room.energyAvailable;
  const capacity = room.energyCapacityAvailable;
  const harvested = harvestWindow[room.name] || 0;
  const spent = spendWindow[room.name] || 0;
  // Reset windows
  harvestWindow[room.name] = 0;
  spendWindow[room.name] = 0;
  return { available: stored, capacity, harvested, spent };
}

/**
 * Collect structure counts.
 */
function getStructureCounts(room: Room): Record<string, number> {
  const counts: Record<string, number> = {};
  const structures = room.find(FIND_STRUCTURES);
  for (const s of structures) {
    counts[s.structureType] = (counts[s.structureType] || 0) + 1;
  }
  return counts;
}

/**
 * Build full room stats snapshot.
 */
function getRoomStats(room: Room): RoomStats {
  const controller = room.controller;
  const energy = getRoomEnergy(room);
  const creeps = getCreepCensus(room);
  const constructionSites = room.find(FIND_CONSTRUCTION_SITES).length;
  const structures = getStructureCounts(room);

  // Rough ETA: ticks to next level based on current progress rate
  let etaTicks: number | null = null;
  if (controller && controller.progress > 0 && controller.level < 8) {
    const remaining = controller.progressTotal - controller.progress;
    const progressPerTick = controller.progress / (Game.time - (Memory.stats?.tick || Game.time - STATS_INTERVAL));
    etaTicks = progressPerTick > 0 ? Math.ceil(remaining / progressPerTick) : null;
  }

  return {
    name: room.name,
    rcl: controller?.level ?? 0,
    energy,
    creeps,
    controller: {
      level: controller?.level ?? 0,
      progress: controller?.progress ?? 0,
      progressTotal: controller?.progressTotal ?? 0,
      etaTicks
    },
    constructionSites,
    structures
  };
}

/**
 * Main telemetry entry point. Call once per tick from main loop.
 * Only writes to Memory every STATS_INTERVAL ticks.
 */
export function collectStats(): void {
  if (Game.time % STATS_INTERVAL !== 0) return;

  const roomStats: Record<string, RoomStats> = {};
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (room.controller?.my) {
      roomStats[roomName] = getRoomStats(room);
    }
  }

  const stats: ColonyStats = {
    tick: Game.time,
    time: Date.now(),
    cpu: {
      bucket: Game.cpu.bucket,
      limit: Game.cpu.limit,
      used: Game.cpu.getUsed()
    },
    gcl: {
      level: Game.gcl.level,
      progress: Game.gcl.progress,
      progressTotal: Game.gcl.progressTotal
    },
    rooms: roomStats
  };

  Memory.stats = stats;
}

// ── Per-creep lifetime stat tracking ──
// These are called by role modules to accumulate per-creep counters.
// On death, counters are flushed to Memory.creepLog by main.ts.

import type { DeathLogEntry } from './types';
import { LOG_CLEANUP_INTERVAL, LOG_MAX_AGE, trackCreepHarvest } from './types';
export { trackCreepHarvest };

/** Record energy delivered to spawn/extensions/towers */
export function trackDelivery(creep: Creep, amount: number): void {
  if (!creep.memory.stats) {
    creep.memory.stats = { energyHarvested: 0, energyDelivered: 0, energyUpgraded: 0, energyBuilt: 0, energyRepaired: 0, spawnTick: Game.time };
  }
  creep.memory.stats.energyDelivered += amount;
}

/** Record energy spent upgrading controller */
export function trackUpgrade(creep: Creep, amount: number): void {
  if (!creep.memory.stats) {
    creep.memory.stats = { energyHarvested: 0, energyDelivered: 0, energyUpgraded: 0, energyBuilt: 0, energyRepaired: 0, spawnTick: Game.time };
  }
  creep.memory.stats.energyUpgraded += amount;
}

/** Record energy spent building */
export function trackBuild(creep: Creep, amount: number): void {
  if (!creep.memory.stats) {
    creep.memory.stats = { energyHarvested: 0, energyDelivered: 0, energyUpgraded: 0, energyBuilt: 0, energyRepaired: 0, spawnTick: Game.time };
  }
  creep.memory.stats.energyBuilt += amount;
}

/** Record energy spent repairing */
export function trackRepair(creep: Creep, amount: number): void {
  if (!creep.memory.stats) {
    creep.memory.stats = { energyHarvested: 0, energyDelivered: 0, energyUpgraded: 0, energyBuilt: 0, energyRepaired: 0, spawnTick: Game.time };
  }
  creep.memory.stats.energyRepaired += amount;
}

// ── Death log & cleanup ──

/** Append a dead creep's lifetime stats to Memory.creepLog */
export function logCreepDeath(name: string, memory: any): void {
  const stats = memory.stats || { energyHarvested: 0, energyDelivered: 0, energyUpgraded: 0, energyBuilt: 0, energyRepaired: 0, spawnTick: Game.time };
  const entry: DeathLogEntry = {
    name,
    role: memory.role || 'unknown',
    body: memory._body || [],
    spawned: stats.spawnTick || Game.time,
    died: Game.time,
    ticksLived: Game.time - (stats.spawnTick || Game.time),
    stats: {
      energyHarvested: stats.energyHarvested || 0,
      energyDelivered: stats.energyDelivered || 0,
      energyUpgraded: stats.energyUpgraded || 0,
      energyBuilt: stats.energyBuilt || 0,
      energyRepaired: stats.energyRepaired || 0,
      spawnTick: stats.spawnTick || 0,
    },
  };

  if (!Memory.creepLog) Memory.creepLog = [];
  Memory.creepLog.push(entry);
}

/** Remove log entries older than LOG_MAX_AGE ticks */
export function cleanCreepLog(): void {
  if (Game.time % LOG_CLEANUP_INTERVAL !== 0) return;
  if (!Memory.creepLog) return;

  const cutoff = Game.time - LOG_MAX_AGE;
  const before = Memory.creepLog.length;
  Memory.creepLog = Memory.creepLog.filter((e: DeathLogEntry) => e.died > cutoff);
  const removed = before - Memory.creepLog.length;
  if (removed > 0) {
    console.log('[cleanup] Removed ' + removed + ' old death log entries (' + Memory.creepLog.length + ' remaining)');
  }
}
