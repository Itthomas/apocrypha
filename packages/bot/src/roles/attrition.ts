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
  retreatDir?: ExitConstant;  // direction of the door we entered through
  phase: 'attriting' | 'retreating';
  sourceRoom: string;         // safe room to heal in
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

  // ── Not at target yet → travel there ──
  if (mem.phase === 'attriting' && creep.room.name !== mem.targetRoom) {
    travelToRoom(creep, mem.targetRoom);
    return true;
  }

  // Record which door we entered the hostile room through
  if (creep.room.name === mem.targetRoom && !mem.retreatDir && creep.room.name !== mem.sourceRoom) {
    const prevRoom = mem.routeRoom || mem.sourceRoom;
    if (prevRoom) {
      const exits = Game.map.describeExits(creep.room.name);
      if (exits) {
        for (const dirStr in exits) {
          if (exits[dirStr] === prevRoom) {
            mem.retreatDir = parseInt(dirStr) as ExitConstant;
            break;
          }
        }
      }
    }
  }

  // ── Attriting phase: sit near door, take damage ──
  if (mem.phase === 'attriting') {
    // Retreat when HP is low
    if (creep.hits / creep.hitsMax < RETREAT_HP_RATIO) {
      mem.phase = 'retreating';
      return true;
    }

    // Stay near the door — move toward it if too far
    if (mem.retreatDir) {
      const exit = creep.pos.findClosestByPath(mem.retreatDir);
      if (exit && creep.pos.getRangeTo(exit) > 2) {
        creep.moveTo(exit, { maxRooms: 1 });
      }
    }
    return true;
  }

  // ── Retreating phase: flee to safety and heal ──
  // In safe room: heal until full, then go back
  if (creep.room.name !== mem.targetRoom || creep.room.name === mem.sourceRoom) {
    if (creep.hits >= creep.hitsMax) {
      mem.phase = 'attriting';
      delete mem.route;
      delete mem.routeRoom;
      return true;
    }
    return true; // still healing
  }

  // In hostile room, below retreat threshold — flee through the door
  if (mem.retreatDir) {
    const exit = creep.pos.findClosestByPath(mem.retreatDir);
    if (exit) {
      creep.moveTo(exit, { maxRooms: 1 });
    }
  }

  return true;
}
