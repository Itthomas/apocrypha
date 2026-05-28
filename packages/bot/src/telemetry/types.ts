/**
 * telemetry/types.ts — Apocrypha Telemetry Data Types
 *
 * Structured stats written to Memory.stats every STATS_INTERVAL ticks.
 * The agent reads this via MCP get_memory to evaluate colony health.
 */

/** Energy flow snapshot for a single room */
export interface RoomEnergyStats {
  /** Energy currently available in spawns + extensions */
  available: number;
  /** Total energy capacity of spawns + extensions */
  capacity: number;
  /** Energy harvested this tick */
  harvested: number;
  /** Energy spent on spawning this tick */
  spent: number;
}

/** Creep census by role */
export interface CreepCensus {
  total: number;
  byRole: Record<string, number>;
}

/** Controller progress */
export interface ControllerStats {
  level: number;
  progress: number;
  progressTotal: number;
  /** Ticks until next level at current rate (approx) */
  etaTicks: number | null;
}

/** Full per-room snapshot */
export interface RoomStats {
  name: string;
  rcl: number;
  energy: RoomEnergyStats;
  creeps: CreepCensus;
  controller: ControllerStats;
  constructionSites: number;
  /** Structures count by type */
  structures: Record<string, number>;
}

/** Root stats object written to Memory */
export interface ColonyStats {
  tick: number;
  time: number; // Date.now() equivalent when written
  cpu: {
    bucket: number;
    limit: number;
    used: number;
  };
  gcl: {
    level: number;
    progress: number;
    progressTotal: number;
  };
  rooms: Record<string, RoomStats>;
}

/** How many ticks between stats snapshots */
export const STATS_INTERVAL = 20;

/** How often to clean the death log */
export const LOG_CLEANUP_INTERVAL = 10000;

/** Max age of log entries before cleanup */
export const LOG_MAX_AGE = 20000;

// ── Per-creep lifetime stats ──

/** Counters tracked in creep.memory.stats */
export interface CreepStats {
  energyHarvested: number;
  energyDelivered: number;
  energyUpgraded: number;
  energyBuilt: number;
  energyRepaired: number;
  spawnTick: number;
}

/** Written to Memory.creepLog on creep death */
export interface DeathLogEntry {
  name: string;
  role: string;
  body: string[];       // body part types
  spawned: number;       // tick spawned
  died: number;          // tick died
  ticksLived: number;
  stats: CreepStats;
}

/** Initialize creep stats in memory on first tick */
export function initCreepStats(creep: Creep): void {
  if (!creep.memory.stats) {
    creep.memory.stats = {
      energyHarvested: 0,
      energyDelivered: 0,
      energyUpgraded: 0,
      energyBuilt: 0,
      energyRepaired: 0,
      spawnTick: Game.time,
    };
  }
}

/** Track energy harvested by a specific creep */
export function trackCreepHarvest(creep: Creep, amount: number): void {
  initCreepStats(creep);
  creep.memory.stats.energyHarvested += amount;
}
