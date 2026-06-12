/**
 * roles/hitAndRunner.ts — Tower-draining siege creep
 *
 * Fixed body: [CARRY×14, MOVE×5, RANGED_ATTACK×2, HEAL×3, MOVE, HEAL]
 * (7:1:2:3 carry:ranged_attack:heal:move, 2 blocks, 2300e)
 *
 * Parks at the exit of a hostile room and self-heals while taking
 * tower fire, just like attrition.  Additionally fires ranged attacks
 * at hostile creeps (priority: ATTACK/RANGED_ATTACK holders not on
 * ramparts) and structures (lowest-health first) to force the enemy
 * towers to spend energy healing, accelerating the drain.
 *
 * Retreats at half HP, heals fully in a safe room, then returns.
 */

import { travelToRoom } from '../lib/travel';

interface HitAndRunnerMemory {
  role: 'hitAndRunner';
  targetRoom: string;
  phase: 'attriting' | 'retreating';
  sourceRoom: string;
  route?: Array<{ exit: ExitConstant; room: string }>;
  routeRoom?: string;
  lastRoom?: string;
}

const RETREAT_HP_RATIO = 0.5;

export function run(creep: Creep): boolean {
  const mem = creep.memory as HitAndRunnerMemory;
  mem.lastRoom = creep.room.name;

  // ── Self-heal every tick (same as attrition) ──
  creep.heal(creep);

  // ── Edge override: move toward room center if on the boundary ──
  const pos = creep.pos;
  if (pos.x === 0 || pos.x === 49 || pos.y === 0 || pos.y === 49) {
    creep.moveTo(new RoomPosition(25, 25, creep.room.name), { maxRooms: 1 });
    return true;
  }

  // ── Not at target yet → travel there (ignore hostile blacklist) ──
  if (mem.phase === 'attriting' && creep.room.name !== mem.targetRoom) {
    travelToRoom(creep, mem.targetRoom, true);
    return true;
  }

  // ── Attriting phase: sit tight, fire ranged attacks, retreat when HP low ──
  if (mem.phase === 'attriting') {
    // Ranged-attack priority 1: hostile creeps with ATTACK or RANGED_ATTACK
    // that are NOT standing on a rampart
    const hostiles = creep.room.find(FIND_HOSTILE_CREEPS);
    const onRampart = (c: Creep) =>
      c.pos.lookFor(LOOK_STRUCTURES).some(s => s.structureType === STRUCTURE_RAMPART);

    const dangerous = hostiles.filter(
      c => (c.getActiveBodyparts(ATTACK) > 0 || c.getActiveBodyparts(RANGED_ATTACK) > 0)
        && !onRampart(c)
    );
    if (dangerous.length > 0) {
      const closest = creep.pos.findClosestByRange(dangerous);
      if (closest && creep.pos.inRangeTo(closest, 3)) {
        creep.rangedAttack(closest);
      }
    }

    // Ranged-attack priority 2: lowest-health hostile structure in range
    const structures = creep.room.find(FIND_HOSTILE_STRUCTURES, {
      filter: s => creep.pos.inRangeTo(s, 3)
    });
    if (structures.length > 0) {
      structures.sort((a, b) => a.hits - b.hits);
      creep.rangedAttack(structures[0]);
    }

    if (creep.hits / creep.hitsMax < RETREAT_HP_RATIO) {
      mem.phase = 'retreating';
    }
    return true;
  }

  // ── Retreating phase: flee through the closest exit ──
  if (creep.room.name !== mem.targetRoom || creep.room.name === mem.sourceRoom) {
    // In safe room — heal until full, then go back
    if (creep.hits >= creep.hitsMax) {
      mem.phase = 'attriting';
      delete mem.route;
      delete mem.routeRoom;
    }
    return true;
  }

  // In hostile room with low HP — find closest exit and flee
  const exit = creep.pos.findClosestByPath(FIND_EXIT);
  if (exit) {
    creep.moveTo(exit, { maxRooms: 1 });
  }

  return true;
}
