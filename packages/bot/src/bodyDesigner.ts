/**
 * bodyDesigner.ts — Apocrypha Body Designer
 *
 * Returns optimal creep body comp for a given role, RCL, and available energy.
 * Each role has tiered body definitions: primary (ideal) and fallback (budget).
 * Used by spawnManager to generate creep body arrays.
 */

/** Body comp spec: counts of WORK, CARRY, MOVE, (optionally TOUGH/ATTACK/etc.) */
export interface BodySpec {
  work: number;
  carry: number;
  move: number;
}

/** Tiered body definitions for a role */
interface BodyTier {
  /** RCL minimum for this tier */
  minRcl: number;
  /** Primary body comp */
  primary: BodySpec;
  /** Fallback if primary is unaffordable */
  fallback?: BodySpec;
}

/** Body tier definitions per role */
const BODY_TIERS: Record<string, BodyTier[]> = {
  miner: [
    { minRcl: 1, primary: { work: 2, carry: 1, move: 1 }, fallback: { work: 1, carry: 1, move: 1 } },
    { minRcl: 2, primary: { work: 3, carry: 1, move: 1 }, fallback: { work: 2, carry: 1, move: 1 } },
    { minRcl: 3, primary: { work: 6, carry: 1, move: 1 }, fallback: { work: 5, carry: 1, move: 1 } },
    { minRcl: 5, primary: { work: 7, carry: 1, move: 2 }, fallback: { work: 6, carry: 1, move: 1 } },
    { minRcl: 7, primary: { work: 10, carry: 1, move: 2 }, fallback: { work: 7, carry: 1, move: 2 } },
  ],
  hauler: [
    { minRcl: 2, primary: { work: 0, carry: 4, move: 1 }, fallback: { work: 0, carry: 2, move: 1 } },
    { minRcl: 3, primary: { work: 0, carry: 8, move: 2 }, fallback: { work: 0, carry: 4, move: 1 } },
    { minRcl: 5, primary: { work: 0, carry: 16, move: 4 }, fallback: { work: 0, carry: 8, move: 2 } },
    { minRcl: 7, primary: { work: 0, carry: 24, move: 6 }, fallback: { work: 0, carry: 16, move: 4 } },
  ],
  survivor: [
    { minRcl: 1, primary: { work: 2, carry: 1, move: 1 }, fallback: { work: 1, carry: 1, move: 1 } },
  ],
  builder: [
    { minRcl: 1, primary: { work: 1, carry: 1, move: 1 }, fallback: { work: 1, carry: 1, move: 1 } },
    { minRcl: 2, primary: { work: 2, carry: 1, move: 1 }, fallback: { work: 1, carry: 1, move: 1 } },
    { minRcl: 3, primary: { work: 4, carry: 2, move: 2 }, fallback: { work: 3, carry: 1, move: 1 } },
    { minRcl: 5, primary: { work: 6, carry: 3, move: 3 }, fallback: { work: 4, carry: 2, move: 2 } },
    { minRcl: 7, primary: { work: 8, carry: 4, move: 4 }, fallback: { work: 6, carry: 3, move: 3 } },
  ],
  upgrader: [
    { minRcl: 1, primary: { work: 1, carry: 1, move: 1 }, fallback: { work: 1, carry: 1, move: 1 } },
    { minRcl: 2, primary: { work: 2, carry: 1, move: 1 }, fallback: { work: 1, carry: 1, move: 1 } },
    { minRcl: 3, primary: { work: 6, carry: 2, move: 2 }, fallback: { work: 4, carry: 1, move: 1 } },
    { minRcl: 5, primary: { work: 8, carry: 2, move: 2 }, fallback: { work: 6, carry: 2, move: 2 } },
    { minRcl: 7, primary: { work: 15, carry: 3, move: 3 }, fallback: { work: 10, carry: 2, move: 2 } },
  ],
};

/**
 * Build a body part array from a BodySpec.
 * Returns [WORK..., CARRY..., MOVE...] in that order for cheaper spawn costs
 * (cheapest parts first → sorting not needed for our simple comps).
 */
function bodyFromSpec(spec: BodySpec): BodyPartConstant[] {
  const parts: BodyPartConstant[] = [];
  for (let i = 0; i < spec.work; i++) parts.push(WORK);
  for (let i = 0; i < spec.carry; i++) parts.push(CARRY);
  for (let i = 0; i < spec.move; i++) parts.push(MOVE);
  return parts;
}

/** Calculate energy cost of a BodySpec */
function specCost(spec: BodySpec): number {
  return spec.work * BODYPART_COST[WORK]
       + spec.carry * BODYPART_COST[CARRY]
       + spec.move * BODYPART_COST[MOVE];
}

/**
 * Get the optimal body for a role at the current RCL and energy budget.
 * Returns the highest-RCL-appropriate primary body if affordable,
 * otherwise falls back to the budget variant, otherwise returns null.
 */
export function getBody(role: string, rcl: number, energyAvailable: number): BodyPartConstant[] | null {
  const tiers = BODY_TIERS[role];
  if (!tiers) return null;

  // Find the highest tier applicable to this RCL
  let bestTier: BodyTier | null = null;
  for (const tier of tiers) {
    if (tier.minRcl <= rcl) bestTier = tier;
  }
  if (!bestTier) return null;

  // Try primary first
  if (specCost(bestTier.primary) <= energyAvailable) {
    return bodyFromSpec(bestTier.primary);
  }

  // Fallback
  if (bestTier.fallback && specCost(bestTier.fallback) <= energyAvailable) {
    return bodyFromSpec(bestTier.fallback);
  }

  return null;
}
