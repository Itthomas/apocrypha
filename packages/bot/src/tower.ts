/**
 * tower.ts — Tower defense and repair logic
 *
 * Towers attack hostiles every tick (highest priority, no duty-cycle gating).
 * When no hostiles are present, towers repair damaged structures on a
 * 500-on/500-off duty cycle (Game.time % 1000 < 500). Ramparts use RCL-gated
 * artificial health thresholds instead of their astronomical actual max health.
 *
 * Towers lock onto a repair target until it's fully repaired (or reaches
 * the rampart threshold) or the tower runs out of energy.
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

/** True if a structure is fully repaired from the tower's perspective */
function isTowerRepairDone(s: AnyStructure, rampartThreshold: number): boolean {
  if (s.structureType === STRUCTURE_RAMPART) {
    if (rampartThreshold === 0) return true;
    const effectiveMax = Math.min(s.hitsMax, rampartThreshold);
    return s.hits >= effectiveMax;
  }
  return s.hits >= s.hitsMax;
}

export function runTowers(room: Room): void {
  const towers = room.find(FIND_MY_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_TOWER && s.store.getUsedCapacity(RESOURCE_ENERGY) > 0
  });
  if (towers.length === 0) return;

  // ── Hostile attack (every tick, no duty-cycle gating) ──
  const hostiles = room.find(FIND_HOSTILE_CREEPS);
  if (hostiles.length > 0) {
    for (const tower of towers) {
      const t = tower as StructureTower;
      const target = t.pos.findClosestByRange(hostiles);
      if (target) t.attack(target);
    }
    return;
  }

  // ── Repair (duty-cycle gated, target-locked) ──
  if (Game.time % 1000 >= 500) return;

  const rcl = room.controller?.level ?? 0;
  const rampartThreshold = getRampartRepairThreshold(rcl);

  if (!Memory.towerTargets) Memory.towerTargets = {};

  for (const tower of towers) {
    const t = tower as StructureTower;
    const currentId = (Memory.towerTargets as Record<string, string>)[t.id];

    // Validate current target
    let target: AnyStructure | null = null;
    if (currentId) {
      const existing = Game.getObjectById(currentId as Id<AnyStructure>);
      if (existing && !isTowerRepairDone(existing, rampartThreshold)) {
        target = existing;
      } else {
        delete (Memory.towerTargets as Record<string, string>)[t.id];
      }
    }

    // Find a new target if needed
    if (!target) {
      target = t.pos.findClosestByRange(FIND_STRUCTURES, {
        filter: s => {
          if (s.structureType === STRUCTURE_WALL) return false;

          if (s.structureType === STRUCTURE_RAMPART) {
            if (rampartThreshold === 0) return false;
            const effectiveMax = Math.min(s.hitsMax, rampartThreshold);
            return s.hits < effectiveMax * TOWER_REPAIR_RATIO;
          }

          return s.hits < s.hitsMax * TOWER_REPAIR_RATIO;
        }
      });

      if (target) {
        (Memory.towerTargets as Record<string, string>)[t.id] = target.id;
      }
    }

    if (target) {
      t.repair(target);
    }
  }
}
