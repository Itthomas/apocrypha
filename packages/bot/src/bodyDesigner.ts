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
  // attacker: carry:attack:move = 1:1:1 (3 parts/block, 180e)
  // attrition: carry:heal:move = 4:1:1 (6 parts/block, 500e)
  attacker: [] as BodyTier[],
  attrition: [] as BodyTier[],

  // Remote worker: 1:3:2 work:carry:move (6 parts/block, 250e)
  remoteWorker: [] as BodyTier[],

  // Ranger: fixed body — no tiering
  ranger: [] as BodyTier[],

  // Hit-and-runner: fixed body — no tiering
  hitAndRunner: [] as BodyTier[],
};

const MAX_CREEP_PARTS = 50;

/** Build the largest combat body that fits in energyAvailable at the role's fixed ratio.
 *  Uses CARRY instead of TOUGH — empty CARRY adds 0 fatigue (no extra MOVE needed)
 *  while providing the same 100 HP, making bodies cheaper and faster to spawn. */
function getCombatBody(role: string, energy: number): BodyPartConstant[] | null {
  let partsPerBlock: number, blockCost: number, carry: number, combat: number, move: number;

  if (role === 'attacker') {
    // 1:1:1 carry:attack:move = 3 parts, 180e
    partsPerBlock = 3; blockCost = 180;
    carry = 1; combat = 1; move = 1;
  } else {
    // 4:1:1 carry:heal:move = 6 parts, 500e
    partsPerBlock = 6; blockCost = 500;
    carry = 4; combat = 1; move = 1;
  }

  const maxByEnergy = Math.floor(energy / blockCost);
  const maxByParts = Math.floor(MAX_CREEP_PARTS / partsPerBlock);
  const blocks = Math.max(1, Math.min(maxByEnergy, maxByParts));

  const spec: BodySpec = role === 'attacker'
    ? { carry: carry * blocks, attack: combat * blocks, move: move * blocks }
    : { carry: carry * blocks, heal: combat * blocks, move: move * blocks };

  return bodyFromSpec(spec);
}

/**
 * Build a body part array from a BodySpec.
 * Standard roles: [WORK..., CARRY..., MOVE...]
 * Attacker:        [CARRY×N, ATTACK×N, MOVE×N]
 * Attrition:       [CARRY×N, MOVE×(M-1), HEAL×(H-1), MOVE, HEAL]
 */
function bodyFromSpec(spec: BodySpec): BodyPartConstant[] {
  // Attacker body: CARRY front, ATTACK middle, MOVE at the end
  if (spec.carry && spec.attack) {
    const parts: BodyPartConstant[] = [];
    for (let i = 0; i < (spec.carry || 0); i++) parts.push(CARRY);
    for (let i = 0; i < (spec.attack || 0); i++) parts.push(ATTACK);
    for (let i = 0; i < spec.move; i++) parts.push(MOVE);
    return parts;
  }

  // Attrition body: CARRY front, MOVE×(M-1), HEAL×(H-1), MOVE, HEAL
  if (spec.carry && spec.heal) {
    const parts: BodyPartConstant[] = [];
    const healCount = spec.heal || 0;
    const moveCount = spec.move || 0;

    for (let i = 0; i < (spec.carry || 0); i++) parts.push(CARRY);
    // Most MOVE parts between CARRY and HEAL, leaving 1 MOVE at the end
    for (let i = 0; i < moveCount - 1; i++) parts.push(MOVE);
    // Most HEAL parts, leaving 1 after the final MOVE
    for (let i = 0; i < healCount - 1; i++) parts.push(HEAL);
    // Second-to-last: MOVE
    parts.push(MOVE);
    // Last: HEAL (arrives last, tanking for the rest)
    parts.push(HEAL);
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
    const BLOCK_COST = 180; // carry(50) + attack(80) + move(50)
    const blocks = Math.min(BLOCKS, Math.floor(energyAvailable / BLOCK_COST));
    if (blocks < 1) return null;
    return bodyFromSpec({ carry: blocks, attack: blocks, move: blocks });
  }

  // Ranger: fixed body — [R_A×2, MOVE×3, HEAL]
  if (role === 'ranger') {
    return [RANGED_ATTACK, RANGED_ATTACK, MOVE, MOVE, MOVE, HEAL];
  }

  // Hit-and-runner: fixed body — [CARRY×14, MOVE×5, R_A×2, HEAL×3, MOVE, HEAL]
  if (role === 'hitAndRunner') {
    return [
      CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY,
      CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY,
      MOVE, MOVE, MOVE, MOVE, MOVE,
      RANGED_ATTACK, RANGED_ATTACK,
      HEAL, HEAL, HEAL,
      MOVE,
      HEAL,
    ];
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
