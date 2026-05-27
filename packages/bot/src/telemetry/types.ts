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
