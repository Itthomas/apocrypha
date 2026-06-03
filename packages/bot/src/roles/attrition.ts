/**
 * roles/attrition.ts — Tower attrition creep
 *
 * Enters a hostile room and sits near the entry door, self-healing
 * while taking tower fire. When health drops below threshold, retreats
 * through the door to heal fully, then repeats. Drains tower energy
 * at negligible creep cost.
 */

import { travelToRoom } from '../lib/travel';

interface AttritionMemory {
  role: 'attrition';
  targetRoom: string;
  retreatDir?: ExitConstant;
  phase: 'attriting' | 'retreating';
  sourceRoom: string;
  route?: Array<{ exit: ExitConstant; room: string }>;
  routeRoom?: string;
  lastRoom?: string;
}

const RETREAT_HP_RATIO = 0.3;

export function run(creep: Creep): boolean {
  const mem = creep.memory as AttritionMemory;
  mem.lastRoom = creep.room.name;

  // Self-heal every tick regardless of phase
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

  // Record which door we entered through
  if (creep.room.name === mem.targetRoom && !mem.retreatDir) {
    const exits = Game.map.describeExits(creep.room.name);
    if (exits) {
      for (const dirStr in exits) {
        if (exits[dirStr] === mem.sourceRoom) {
          mem.retreatDir = parseInt(dirStr) as ExitConstant;
          break;
        }
      }
    }
  }

  // ── Attriting phase: sit near door, take damage ──
  if (mem.phase === 'attriting') {
    if (creep.hits / creep.hitsMax < RETREAT_HP_RATIO) {
      mem.phase = 'retreating';
      return true;
    }

    if (mem.retreatDir) {
      const exit = creep.pos.findClosestByPath(mem.retreatDir);
      if (exit && creep.pos.getRangeTo(exit) > 2) {
        creep.moveTo(exit, { maxRooms: 1 });
      }
    }
    return true;
  }

  // ── Retreating phase: flee to safety and heal ──
  if (creep.room.name !== mem.targetRoom || creep.room.name === mem.sourceRoom) {
    if (creep.hits >= creep.hitsMax) {
      mem.phase = 'attriting';
      delete mem.route;
      delete mem.routeRoom;
    }
    return true;
  }

  if (mem.retreatDir) {
    const exit = creep.pos.findClosestByPath(mem.retreatDir);
    if (exit) creep.moveTo(exit, { maxRooms: 1 });
  }

  return true;
}
