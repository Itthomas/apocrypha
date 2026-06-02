/**
 * roles/scout.ts — Colonization scout (two-phase)
 *
 * Phase 1 (Transit): travelToRoom using Game.map.findRoute exit-by-exit
 *   routing. No manual steering, no cross-room moveTo edge failures.
 *
 * Phase 2 (Explore): visited-filtered random walk. On each room entry,
 *   picks a random exit from those leading to unvisited rooms. Falls
 *   back to any random exit if all neighbors are visited.
 *
 * Every room entered (both phases) is scored and saved to the shared
 * Memory.colonization leaderboard via scoreRoom().
 *
 * Edge override: scouts on room boundaries (x/y 0 or 49) pathfind to
 * room center instead of struggling with edge exit tiles.
 */

import { scoreRoom } from '../colonization/scoring';
import { travelToRoom } from '../lib/travel';

interface ScoutMemory {
  role: 'scout';
  targetRoom: string;
  phase: 'transit' | 'explore';
  sourceRoom: string;
  respawns: number;
  chosenExit: number;
  lastRoom: string;
  route?: Array<{ exit: ExitConstant; room: string }>;
  routeRoom?: string;
}

type ExitDirConst = 1 | 3 | 5 | 7;

const EXIT_TO_FIND: Record<ExitDirConst, ExitConstant> = {
  1: FIND_EXIT_TOP,
  3: FIND_EXIT_RIGHT,
  5: FIND_EXIT_BOTTOM,
  7: FIND_EXIT_LEFT,
};

export function run(creep: Creep): boolean {
  const mem = creep.memory as ScoutMemory;
  const col = Memory.colonization as any;
  if (!col?.active || Game.time >= col.deadline) {
    return false;
  }

  // ── Edge override: move toward room center if on the boundary ──
  const pos = creep.pos;
  if (pos.x === 0 || pos.x === 49 || pos.y === 0 || pos.y === 49) {
    creep.moveTo(new RoomPosition(25, 25, creep.room.name), { maxRooms: 1 });
    return true;
  }

  const roomName = creep.room.name;

  // ── Score every new room (both phases) ──
  if (col.roomsVisited.indexOf(roomName) === -1) {
    col.roomsVisited.push(roomName);
    const result = scoreRoom(roomName);
    if (result && result.score > 0) {
      col.candidates[roomName] = result;
      if (!col.bestRoom || result.score > col.bestRoom.score) {
        col.bestRoom = {
          name: roomName,
          score: result.score,
          worldX: result.worldX,
          worldY: result.worldY,
        };
      }
    }
  }

  // ── Transit phase: findRoute → exit-by-exit travel ──
  if (mem.phase === 'transit') {
    if (roomName === mem.targetRoom) {
      mem.phase = 'explore';
    } else {
      travelToRoom(creep, mem.targetRoom);
      return true;
    }
  }

  // ── Explore phase: visited-filtered random walk ──
  // Choose exit once per room (anti-oscillation)
  if (mem.lastRoom !== roomName) {
    mem.lastRoom = roomName;
    mem.chosenExit = pickExploreExit(creep, col.roomsVisited as string[]);
  }

  const findConst = EXIT_TO_FIND[mem.chosenExit as ExitDirConst];
  if (findConst) {
    const tiles = creep.room.find(findConst);
    if (tiles.length > 0) {
      creep.moveTo(tiles[0], { reusePath: 10, maxRooms: 1 });
    }
  }

  return true;
}

// ── Explore exit selection ──

/**
 * Pick a random exit preferring rooms NOT in the shared visited set.
 * Falls back to any random exit if all neighbors are already visited.
 */
function pickExploreExit(creep: Creep, visited: string[]): number {
  const exitsRaw = Game.map.describeExits(creep.room.name);
  if (!exitsRaw) return 1;

  const unvisited: ExitDirConst[] = [];
  const all: ExitDirConst[] = [];

  for (const dirStr in exitsRaw) {
    const dir = parseInt(dirStr) as ExitDirConst;
    if (!(dir in EXIT_TO_FIND)) continue;
    all.push(dir);
    if (visited.indexOf(exitsRaw[dirStr]) === -1) {
      unvisited.push(dir);
    }
  }

  const pool = unvisited.length > 0 ? unvisited : all;
  return pool[Math.floor(Math.random() * pool.length)];
}
