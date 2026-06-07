/**
 * bodyDesigner.ts — Apocrypha Body Designer
 *
 * Returns optimal creep body comp for a given role, RCL, and available energy.
 * Each role has tiered body definitions: primary (ideal) and fallback (budget).
 * Used by spawnManager to generate creep body arrays.
 */

/** Body comp spec: counts of WORK, CARRY, MOVE, (optionally TOUGH/ATTACK/etc.) */
export interface BodySpec {
  work?: number;
  carry?: number;
  move: number;
  tough?: number;
  attack?: number;
  heal?: number;
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
    { minRcl: 1, primary: { work: 6, carry: 1, move: 3 }, fallback: { work: 6, carry: 1, move: 1 } },
  ],
  hauler: [] as BodyTier[],
  survivor: [
    { minRcl: 1, primary: { work: 8, carry: 16, move: 12 }, fallback: { work: 6, carry: 14, move: 10 } },
    { minRcl: 1, primary: { work: 6, carry: 14, move: 10 }, fallback: { work: 4, carry: 8, move: 6 } },
    { minRcl: 1, primary: { work: 4, carry: 8, move: 6 }, fallback: { work: 3, carry: 5, move: 4 } },
    { minRcl: 1, primary: { work: 3, carry: 5, move: 4 }, fallback: { work: 2, carry: 4, move: 2 } },
    { minRcl: 1, primary: { work: 2, carry: 4, move: 2 }, fallback: { work: 1, carry: 3, move: 1 } },
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
  // Combat: dynamically sized — largest possible block count at given ratio
  // attacker: tough:attack:move = 1:1:2 (4 parts/block, 190e)
  // attrition: tough:heal:move = 5:1:3 (9 parts/block, 450e)
  attacker: [] as BodyTier[],
  attrition: [] as BodyTier[],

  // Remote worker: 1:3:2 work:carry:move (6 parts/block, 250e)
  remoteWorker: [] as BodyTier[],
};

const MAX_CREEP_PARTS = 50;

/** Build the largest combat body that fits in energyAvailable at the role's fixed ratio */
function getCombatBody(role: string, energy: number): BodyPartConstant[] | null {
  let partsPerBlock: number, blockCost: number, tough: number, combat: number, move: number;

  if (role === 'attacker') {
    // 1:1:2 tough:attack:move = 4 parts, 190e
    partsPerBlock = 4; blockCost = 190;
    tough = 1; combat = 1; move = 2;
  } else {
    // 3:1:4 tough:heal:move = 8 parts, 480e
    partsPerBlock = 8; blockCost = 480;
    tough = 3; combat = 1; move = 4;
  }

  const maxByEnergy = Math.floor(energy / blockCost);
  const maxByParts = Math.floor(MAX_CREEP_PARTS / partsPerBlock);
  const blocks = Math.max(1, Math.min(maxByEnergy, maxByParts));

  const spec: BodySpec = role === 'attacker'
    ? { tough: tough * blocks, attack: combat * blocks, move: move * blocks }
    : { tough: tough * blocks, heal: combat * blocks, move: move * blocks };

  return bodyFromSpec(spec);
}

/**
 * Build a body part array from a BodySpec.
 * Standard roles: [WORK..., CARRY..., MOVE...]
 * Combat roles: [TOUGH×N, MOVE×N, ATTACK/HEAL interleaved with MOVE]
 */
function bodyFromSpec(spec: BodySpec): BodyPartConstant[] {
  // Combat body: TOUGH front, remaining MOVE pool, then ops interleaved 1:1
  if (spec.tough && (spec.attack || spec.heal)) {
    const parts: BodyPartConstant[] = [];
    const combatCount = spec.attack || spec.heal || 0;
    const moveCount = spec.move || 0;
    const moveExtra = moveCount - combatCount; // MOVE beyond the 1:1 interleave

    // Tough front
    for (let i = 0; i < (spec.tough || 0); i++) parts.push(TOUGH);

    // Remaining MOVE pool between tough and ops
    for (let i = 0; i < moveExtra; i++) parts.push(MOVE);

    // Operational parts interleaved 1:1 with MOVE
    for (let i = 0; i < combatCount; i++) {
      if (spec.attack) parts.push(ATTACK);
      else parts.push(HEAL);
      parts.push(MOVE);
    }
    return parts;
  }

  // Standard body
  const parts: BodyPartConstant[] = [];
  for (let i = 0; i < (spec.work || 0); i++) parts.push(WORK);
  for (let i = 0; i < (spec.carry || 0); i++) parts.push(CARRY);
  for (let i = 0; i < spec.move; i++) parts.push(MOVE);
  return parts;
}

/** Calculate energy cost of a BodySpec */
function specCost(spec: BodySpec): number {
  return (spec.work || 0) * BODYPART_COST[WORK]
       + (spec.carry || 0) * BODYPART_COST[CARRY]
       + spec.move * BODYPART_COST[MOVE]
       + (spec.tough || 0) * BODYPART_COST[TOUGH]
       + (spec.attack || 0) * BODYPART_COST[ATTACK]
       + (spec.heal || 0) * BODYPART_COST[HEAL];
}

/**
 * Get the optimal body for a role at the current RCL and energy budget.
 * Tries all matching tiers (minRcl ≤ current RCL), sorted by cost descending.
 * Returns the most expensive affordable spec — regardless of which tier it's from.
 *
 * @param energyCap Optional room.energyCapacityAvailable — only used for
 *   miner fallback body when extensions are too few for the 700e baseline.
 */
export function getBody(role: string, rcl: number, energyAvailable: number, energyCap?: number): BodyPartConstant[] | null {
  // Combat roles: largest possible with fixed ratio, RCL ≥ 3
  if (role === 'attacker' || role === 'attrition') {
    if (rcl < 3) return null;
    return getCombatBody(role, energyAvailable);
  }

  // Defender: same 1:1:2 tough:attack:move ratio as attacker, capped at 5 blocks
  // for fast spawning. 5 blocks = 950e, spawns in ~10 ticks at RCL 6.
  if (role === 'defender') {
    if (rcl < 3) return null;
    const BLOCKS = 5;
    const BLOCK_COST = 190; // tough(10) + attack(80) + move×2(100)
    const blocks = Math.min(BLOCKS, Math.floor(energyAvailable / BLOCK_COST));
    if (blocks < 1) return null;
    return bodyFromSpec({ tough: blocks, attack: blocks, move: blocks * 2 });
  }

  // Remote worker: 1:3:2 work:carry:move = 6 parts, 250e per block
  if (role === 'remoteWorker') {
    const blockCost = 350; // WORK + CARRY×3 + MOVE×2 = 100 + 150 + 100
    const blocks = Math.floor(energyAvailable / blockCost);
    const maxByParts = Math.floor(MAX_CREEP_PARTS / 6);
    const n = Math.min(blocks, maxByParts, 8);
    if (n < 4) return null;
    return bodyFromSpec({ work: n, carry: n * 3, move: n * 2 });
  }

  // Hauler: 2:1 carry:move, at most 1/2 of max energy capacity
  if (role === 'hauler' && energyCap !== undefined) {
    const budget = Math.floor(energyCap / 2);
    const blocksPerEnergy = Math.floor(budget / 150); // CARRY×2 + MOVE = 150e
    const blocksPerParts = Math.floor(MAX_CREEP_PARTS / 3);
    const blocks = Math.max(1, Math.min(blocksPerEnergy, blocksPerParts));
    return bodyFromSpec({ carry: blocks * 2, move: blocks });
  }

  const tiers = BODY_TIERS[role];
  if (!tiers) return null;

  // Collect every spec from every matching tier (primary + fallback)
  const specs: BodySpec[] = [];
  for (const tier of tiers) {
    if (tier.minRcl <= rcl) {
      specs.push(tier.primary);
      if (tier.fallback) specs.push(tier.fallback);
    }
  }

  // Miner: add 4:1:1 fallback when room max energy capacity < 700
  if (role === 'miner' && energyCap !== undefined && energyCap < 700) {
    specs.push({ work: 4, carry: 1, move: 1 });
  }

  // Sort by cost descending — best body first
  specs.sort((a, b) => specCost(b) - specCost(a));

  // Return the most expensive spec we can afford
  for (const spec of specs) {
    if (specCost(spec) <= energyAvailable) {
      return bodyFromSpec(spec);
    }
  }

  return null;
}
