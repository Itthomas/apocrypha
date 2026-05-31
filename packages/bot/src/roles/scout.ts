/**
 * roles/scout.ts — Colonization scout
 *
 * 1-MOVE disposable creep that explores the world in a cardinal bearing
 * direction, scoring new rooms for colonization candidacy.
 *
 * Maze routing: bearing-priority exit selection with single prevRoom
 * backtrack fallback. No trail needed — prevRoom alone prevents the
 * ping-pong loop while allowing dead-end escape.
 */

import { scoreRoom } from '../colonization/scoring';

interface ScoutMemory {
  role: 'scout';
  bearing: number;      // 0..315 in 45° steps
  temperature: number;  // 0..1 randomness offset
  prevRoom: string;     // room entered FROM
  respawns: number;
  sourceRoom: string;
}

const BEARING_DEG: Record<number, number> = {
  0: 0,   1: 45,  2: 90,  3: 135,
  4: 180, 5: 225, 6: 270, 7: 315,
};

const DEG_TO_EXIT_FIND: Record<number, ExitConstant> = {
  0:   FIND_EXIT_TOP,
  45:  FIND_EXIT_TOP_RIGHT,
  90:  FIND_EXIT_RIGHT,
  135: FIND_EXIT_BOTTOM_RIGHT,
  180: FIND_EXIT_BOTTOM,
  225: FIND_EXIT_BOTTOM_LEFT,
  270: FIND_EXIT_LEFT,
  315: FIND_EXIT_TOP_LEFT,
};

const EXIT_DIR_TO_DEG: Record<string, number> = {
  '1': 0,    '3': 45,   '5': 90,   '7': 135,    // TOP=1, TOP_RIGHT=3, RIGHT=5, BOTTOM_RIGHT=7
};

export function run(creep: Creep): boolean {
  const mem = creep.memory as ScoutMemory;
  const col = Memory.colonization;
  if (!col?.active || Game.time >= col.deadline) {
    return false; // wave over, scout obsolete
  }

  const roomName = creep.room.name;

  // ── New room → score it ──
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

  // ── Get exits ──
  const exits = Game.map.describeExits(roomName);
  if (!exits) return false;

  const exitEntries: Array<{ name: string; deg: number; find: ExitConstant }> = [];
  // Map exit direction constants to degrees
  const TOP = 1, RIGHT = 3, BOTTOM = 5, LEFT = 7;
  // describeExits returns { "1": "roomName", "3": "roomName", ... }
  for (const dirStr in exits) {
    const dir = parseInt(dirStr);
    const remoteName = exits[dirStr];
    let deg = 0;
    let find: ExitConstant = FIND_EXIT_TOP;
    if (dir === TOP) { deg = 0;   find = FIND_EXIT_TOP; }
    else if (dir === 3)  { deg = 45;  find = FIND_EXIT_TOP_RIGHT; } // TOP_RIGHT
    else if (dir === RIGHT) { deg = 90;  find = FIND_EXIT_RIGHT; }
    else if (dir === 7)  { deg = 135; find = FIND_EXIT_BOTTOM_RIGHT; } // BOTTOM_RIGHT
    else if (dir === BOTTOM) { deg = 180; find = FIND_EXIT_BOTTOM; }
    else if (dir === 5)  { deg = 225; find = FIND_EXIT_BOTTOM_LEFT; } // BOTTOM_LEFT
    else if (dir === LEFT) { deg = 270; find = FIND_EXIT_LEFT; }
    else if (dir === 1)  { deg = 315; find = FIND_EXIT_TOP_LEFT; } // TOP_LEFT
    exitEntries.push({ name: remoteName, deg, find });
  }

  if (exitEntries.length === 0) return false;

  // ── Filter: exclude prevRoom (unless it's the only exit) ──
  let forward = exitEntries.filter(e => e.name !== mem.prevRoom);
  if (forward.length === 0) forward = exitEntries;

  // ── Score exits by bearing closeness + temperature ──
  const bearingDeg = (mem.bearing ?? 0) * 45;
  let bestExit = forward[0];
  let bestScore = -Infinity;

  for (const exit of forward) {
    const angleDiff = Math.abs(bearingDeg - exit.deg);
    const base = 180 - angleDiff;
    const tempJitter = (mem.temperature ?? 0) * 180 * Math.random();
    const score = base + tempJitter;
    if (score > bestScore) {
      bestScore = score;
      bestExit = exit;
    }
  }

  // ── Move toward chosen exit ──
  const tiles = creep.room.find(bestExit.find);
  if (tiles.length > 0) {
    creep.moveTo(tiles[0], { reusePath: 10, maxRooms: 1 });
  }

  // Record prevRoom for next tick (when boundary is crossed)
  mem.prevRoom = roomName;

  return true;
}
