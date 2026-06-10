/**
 * roles/ranger.ts — Seasonal world score collector & scout hunter
 *
 * Fixed body: [RANGED_ATTACK, RANGED_ATTACK, MOVE, MOVE, MOVE, HEAL]
 *
 * Roams randomly through unexplored rooms, collecting score items and
 * killing hostile scouts. Kites at range 2-3. Avoids towers and hostile
 * rooms. Maintains a 20-room personal buffer to bias exploration toward
 * new territory.
 */

import { isHallway } from '../lib/travel';

/** Max rooms in the personal exploration buffer */
const BUFFER_SIZE = 20;

interface RangerMemory {
  role: 'ranger';
  roomBuffer: string[];
  targetExit?: ExitConstant;
  lastRoom?: string;
}

export function run(creep: Creep): boolean {
  const mem = creep.memory as RangerMemory;
  if (!mem.roomBuffer) mem.roomBuffer = [];

  // ── Self-heal every tick ──
  creep.heal(creep);

  // ── Edge override ──
  // If on the boundary and the room is owned with a tower, freeze:
  // staying on the exit square loops back to the previous room next tick.
  const pos = creep.pos;
  if (pos.x === 0 || pos.x === 49 || pos.y === 0 || pos.y === 49) {
    const ctrl = creep.room.controller;
    if (ctrl && ctrl.owner && !ctrl.my) {
      const towers = creep.room.find(FIND_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_TOWER
      });
      if (towers.length > 0) {
        if (!Memory.hostileRooms) Memory.hostileRooms = {};
        (Memory.hostileRooms as any)[creep.room.name] = Game.time;
        return true; // stay still — don't move off the exit tile
      }
    }
    // No tower threat — move to center normally
    creep.moveTo(new RoomPosition(25, 25, creep.room.name), { maxRooms: 1 });
    return true;
  }

  // Track room changes: flush stale exit target, update buffer
  if (mem.lastRoom !== creep.room.name) {
    mem.targetExit = undefined;
    pushBuffer(mem, creep.room.name);
    mem.lastRoom = creep.room.name;
  }

  // ── Priority 1: hunt killable hostiles ──
  const hostiles = creep.room.find(FIND_HOSTILE_CREEPS);
  if (hostiles.length > 0 && canEngage(hostiles)) {
    const closest = creep.pos.findClosestByPath(hostiles);
    if (closest) {
      const range = creep.pos.getRangeTo(closest);
      if (range <= 3) {
        creep.rangedAttack(closest);
      }
      if (range > 3) {
        creep.moveTo(closest);
      } else if (range === 1) {
        // Too close — kite away
        creep.moveTo(closest, { flee: true });
      }
      // range 2-3: attack and hold position
      return true;
    }
  }

  // ── Priority 2: collect score items ──
  const scores = creep.room.find(FIND_SCORES);
  if (scores.length > 0) {
    const best = scores.length === 1
      ? scores[0]
      : scores.reduce((a, b) => b.score > a.score ? b : a);
    if (!creep.pos.isEqualTo(best.pos)) {
      creep.moveTo(best);
    }
    return true;
  }

  // ── Default: path to a random unexplored exit ──
  pathToExit(creep, mem);
  return true;
}

// ── Helpers ──

function pushBuffer(mem: RangerMemory, room: string): void {
  mem.roomBuffer.push(room);
  while (mem.roomBuffer.length > BUFFER_SIZE) {
    mem.roomBuffer.shift();
  }
}

/** Choose a random exit once per room, preferring rooms not recently
 *  visited. Excludes hostile rooms and hallways. Sticks to the
 *  chosen exit until the creep leaves the room. */
function pathToExit(creep: Creep, mem: RangerMemory): void {
  // Already have a target — just move toward it
  if (mem.targetExit !== undefined) {
    const exit = creep.pos.findClosestByPath(mem.targetExit);
    if (exit) creep.moveTo(exit, { maxRooms: 1 });
    return;
  }

  const exits = Game.map.describeExits(creep.room.name);
  if (!exits) return;

  // Collect valid exits (skip hostile rooms and hallways)
  const hostileRooms = Memory.hostileRooms as Record<string, number> | undefined;
  const candidates: Array<{ dir: ExitConstant; room: string }> = [];
  let fresh: typeof candidates = [];

  for (const _dir in exits) {
    const adj = exits[_dir];
    if (!adj) continue;
    if (isHallway(adj)) continue;
    if (hostileRooms?.[adj] && Game.time - hostileRooms[adj] < 10000) continue;
    const entry = { dir: parseInt(_dir) as ExitConstant, room: adj };
    candidates.push(entry);
    if (!mem.roomBuffer.includes(adj)) {
      fresh.push(entry);
    }
  }

  if (candidates.length === 0) return;

  // Prefer fresh rooms; fall back to any candidate
  const pool = fresh.length > 0 ? fresh : candidates;
  const chosen = pool[Math.floor(Math.random() * pool.length)];
  mem.targetExit = chosen.dir;
}

/** Assess whether the ranger can safely engage the hostiles in this room. */
function canEngage(hostiles: Creep[]): boolean {
  let totalRanged = 0;
  let totalParts = 0;

  for (const hostile of hostiles) {
    totalRanged += hostile.getActiveBodyparts(RANGED_ATTACK);
    totalParts += hostile.body.length;
  }

  return totalRanged <= 2 && totalParts <= 12;
}
