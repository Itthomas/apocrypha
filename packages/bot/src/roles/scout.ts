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
  bearing: number;      // 0..7 in 45° steps (N, NE, E, SE, S, SW, W, NW)
  temperature: number;  // 0..1 randomness offset
  prevRoom: string;     // room entered FROM
  respawns: number;
  sourceRoom: string;
}

// Bearing → cardinal direction degrees (diagonals handled by scoring)
const BEARING_DEG: Record<number, number> = {
  0: 0,   1: 45,  2: 90,  3: 135,
  4: 180, 5: 225, 6: 270, 7: 315,
};

// Only 4 cardinal exit constants exist in Screeps
type ExitDirConst = 1 | 3 | 5 | 7;

const EXIT_TO_DEG: Record<ExitDirConst, number> = {
  1: 0,    // TOP    → N
  3: 90,   // RIGHT  → E
  5: 180,  // BOTTOM → S
  7: 270,  // LEFT   → W
};

const EXIT_TO_FIND: Record<ExitDirConst, ExitConstant> = {
  1: FIND_EXIT_TOP,
  3: FIND_EXIT_RIGHT,
  5: FIND_EXIT_BOTTOM,
  7: FIND_EXIT_LEFT,
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
  const exitsRaw = Game.map.describeExits(roomName);
  if (!exitsRaw) return false;

  // describeExits returns { "1": "W7N4", "3": "W8N4", ... }
  // Keys are direction constants as strings (1=TOP, 3=RIGHT, 5=BOTTOM, 7=LEFT)
  const exitEntries: Array<{ name: string; deg: number; find: ExitConstant }> = [];
  for (const dirStr in exitsRaw) {
    const dir = parseInt(dirStr) as ExitDirConst;
    if (!(dir in EXIT_TO_DEG)) continue;
    exitEntries.push({
      name: exitsRaw[dirStr],
      deg: EXIT_TO_DEG[dir],
      find: EXIT_TO_FIND[dir],
    });
  }

  if (exitEntries.length === 0) return false;

  // ── Filter: exclude prevRoom (unless it's the only exit) ──
  let forward = exitEntries.filter(e => e.name !== mem.prevRoom);
  if (forward.length === 0) forward = exitEntries;

  // ── Score exits by bearing closeness + temperature ──
  const bearingDeg = BEARING_DEG[mem.bearing] ?? 0;
  let bestExit = forward[0];
  let bestScore = -Infinity;

  for (const exit of forward) {
    // Angular distance — dip around the circle (720° arc)
    let angleDiff = Math.abs(bearingDeg - exit.deg);
    if (angleDiff > 180) angleDiff = 360 - angleDiff;
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
