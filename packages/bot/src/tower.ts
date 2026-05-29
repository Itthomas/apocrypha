/**
 * tower.ts — Tower defense and repair logic
 *
 * Towers repair damaged structures on a 500-on/500-off duty cycle
 * (Game.time % 1000 < 500). Ramparts use RCL-gated artificial health
 * thresholds instead of their astronomical actual max health.
 */

// ── Rampart Health Thresholds ──
// Towers and builders treat these as the "effective max health" for
// ramparts at each RCL. Set to 0 for RCLs where ramparts shouldn't
// be maintained at all.

export const RAMPART_THRESHOLDS: Record<number, number> = {
  1: 0,
  2: 0,
  3: 0,
  4: 0,
  5: 20_000,
  6: 100_000,
  7: 500_000,
  8: 1_000_000,
};

/** Get the effective rampart repair health cap for the current RCL */
export function getRampartRepairThreshold(rcl: number): number {
  return RAMPART_THRESHOLDS[rcl] ?? 0;
}

// ── Tower Logic ──

const TOWER_REPAIR_RATIO = 2 / 3; // repair when structure health drops below this

export function runTowers(room: Room): void {
  // Duty cycle: repair for 500 ticks, rest for 500 ticks
  if (Game.time % 1000 >= 500) return;

  const towers = room.find(FIND_MY_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_TOWER && s.store.getUsedCapacity(RESOURCE_ENERGY) > 0
  });
  if (towers.length === 0) return;

  const rcl = room.controller?.level ?? 0;
  const rampartThreshold = getRampartRepairThreshold(rcl);

  for (const tower of towers) {
    const t = tower as StructureTower;

    // Find the most damaged structure (below repair threshold, nearest first)
    const target = t.pos.findClosestByRange(FIND_STRUCTURES, {
      filter: s => {
        if (s.structureType === STRUCTURE_WALL) return false;

        // Ramparts: use artificial threshold
        if (s.structureType === STRUCTURE_RAMPART) {
          if (rampartThreshold === 0) return false;
          const effectiveMax = Math.min(s.hitsMax, rampartThreshold);
          return s.hits < effectiveMax * TOWER_REPAIR_RATIO;
        }

        // Everything else: use actual max health
        return s.hits < s.hitsMax * TOWER_REPAIR_RATIO;
      }
    });

    if (target) {
      t.repair(target);
    }
  }
}
