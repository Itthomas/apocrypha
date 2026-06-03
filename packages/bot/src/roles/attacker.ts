/**
 * roles/attacker.ts — Solo attacker creep
 *
 * Travels to target room via findRoute routing. Every tick (even in
 * transit), attacks highest-priority hostile within range while moving
 * toward the closest target of that priority.
 *
 * Target priority ladder:
 *   1. Towers
 *   2. Spawns
 *   3. Creeps with ATTACK parts
 *   4. Creeps with RANGED_ATTACK parts
 *   5. Any other hostile creeps
 *   6. All other hostile structures
 *
 * Clears the room tier by tier.
 */

import { travelToRoom } from '../lib/travel';

interface AttackerMemory {
  role: 'attacker';
  targetRoom: string;
  route?: Array<{ exit: ExitConstant; room: string }>;
  routeRoom?: string;
  lastRoom?: string;
}

export function run(creep: Creep): boolean {
  const mem = creep.memory as AttackerMemory;
  mem.lastRoom = creep.room.name;

  // Not in target room → travel there, attack anything in range along the way
  if (creep.room.name !== mem.targetRoom) {
    const tiers = getPriorityTiers(creep);
    for (const tier of tiers) {
      const inRange = tier.filter(t => creep.pos.inRangeTo(t.pos, 1));
      if (inRange.length > 0) { creep.attack(inRange[0] as any); break; }
    }
    travelToRoom(creep, mem.targetRoom, true);
    return true;
  }

  // In target room: attack best tier, move toward same tier
  const tiers = getPriorityTiers(creep);
  for (const tier of tiers) {
    if (tier.length === 0) continue;

    // Attack closest in-range target from this tier
    const inRange = tier.filter(t => creep.pos.inRangeTo(t.pos, 1));
    if (inRange.length > 0) {
      creep.attack(inRange[0] as any);
    }

    // Move toward closest target from this tier (don't exclude anything)
    const moveTarget = creep.pos.findClosestByPath(tier as any) as unknown as Attackable;
    if (moveTarget) creep.moveTo(moveTarget as any);
    return true;
  }

  return true;
}

// ── Priority ladder ──

type Attackable = AnyCreep | AnyStructure;

function getPriorityTiers(creep: Creep): Attackable[][] {
  const hostileCreeps = creep.room.find(FIND_HOSTILE_CREEPS);
  const hostileStructures = creep.room.find(FIND_HOSTILE_STRUCTURES);

  return [
    // Tier 1: Towers
    hostileStructures.filter(s => s.structureType === STRUCTURE_TOWER),
    // Tier 2: Spawns
    hostileStructures.filter(s => s.structureType === STRUCTURE_SPAWN),
    // Tier 3: Creeps with ATTACK
    hostileCreeps.filter(c => c.getActiveBodyparts(ATTACK) > 0),
    // Tier 4: Creeps with RANGED_ATTACK
    hostileCreeps.filter(c => c.getActiveBodyparts(RANGED_ATTACK) > 0),
    // Tier 5: Any other hostile creeps
    hostileCreeps.filter(c =>
      c.getActiveBodyparts(ATTACK) === 0 && c.getActiveBodyparts(RANGED_ATTACK) === 0
    ),
    // Tier 6: All other hostile structures
    hostileStructures.filter(s =>
      s.structureType !== STRUCTURE_TOWER && s.structureType !== STRUCTURE_SPAWN
    ),
  ];
}
