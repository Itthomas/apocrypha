/**
 * roles/scout.ts — Colonization scout
 *
 * 1-MOVE disposable creep that explores the world in a cardinal bearing
 * direction, scoring new rooms for colonization candidacy.
 *
 * Maze routing: bearing-priority exit selection with short trail to
 * prevent ping-pong re-entry loops.  prevRoom is the last-resort
 * backtrack when every exit leads to a recently-visited room.
 * Exit chosen once per room and persisted.
 */

import { scoreRoom } from '../colonization/scoring';

interface ScoutMemory {
  role: 'scout';
  bearing: number;      // 0..7 in 45° steps (N, NE, E, SE, S, SW, W, NW)
  temperature: number;  // 0..1 randomness offset
  prevRoom: string;     // room entered FROM
  chosenExit: number;   // chosen exit direction (1/3/5/7), persisted per room
  lastRoom: string;     // room where chosenExit was selected
  trail: string[];      // last 3 room names visited (loop prevention)
  respawns: number;
  sourceRoom: string;
}

const TRAIL_SIZE = 3;

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
    return false;
  }

  // ── Edge override: move toward room center if on the boundary ──
  const pos = creep.pos;
  if (pos.x === 0 || pos.x === 49 || pos.y === 0 || pos.y === 49) {
    creep.moveTo(new RoomPosition(25, 25, creep.room.name), { maxRooms: 1 });
    return true;
  }

  const roomName = creep.room.name;

  // ── Maintain trail (last N rooms, prevents immediate re-entry) ──
  if (!mem.trail) mem.trail = [];
  if (mem.trail[mem.trail.length - 1] !== roomName) {
    mem.trail.push(roomName);
    if (mem.trail.length > TRAIL_SIZE) mem.trail.shift();
  }

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

  // ── Choose exit (once per room) ──
  if (mem.lastRoom !== roomName) {
    mem.lastRoom = roomName;
    mem.chosenExit = pickExit(creep, mem);
  }

  // ── Move toward chosen exit ──
  const findConst = EXIT_TO_FIND[mem.chosenExit as ExitDirConst];
  if (findConst) {
    const tiles = creep.room.find(findConst);
    if (tiles.length > 0) {
      creep.moveTo(tiles[0], { reusePath: 10, maxRooms: 1 });
    }
  }

  // Record prevRoom for when boundary is crossed
  mem.prevRoom = roomName;

  return true;
}

// ── Exit selection ──

function pickExit(creep: Creep, mem: ScoutMemory): number {
  const exitsRaw = Game.map.describeExits(creep.room.name);
  if (!exitsRaw) return 1; // fallback TOP

  const exitEntries: Array<{ name: string; deg: number; dirConst: ExitDirConst }> = [];
  for (const dirStr in exitsRaw) {
    const dir = parseInt(dirStr) as ExitDirConst;
    if (!(dir in EXIT_TO_DEG)) continue;
    exitEntries.push({
      name: exitsRaw[dirStr],
      deg: EXIT_TO_DEG[dir],
      dirConst: dir,
    });
  }

  if (exitEntries.length === 0) return 1;

  // Filter: exclude trail rooms (prevents ping-pong loops)
  // prevRoom is kept as last-resort fallback
  const trail = mem.trail ?? [];
  const nonPrevBacktrack = exitEntries.filter(
    e => e.name !== mem.prevRoom && trail.indexOf(e.name) === -1
  );

  let forward: typeof exitEntries;
  if (nonPrevBacktrack.length > 0) {
    forward = nonPrevBacktrack; // prefer non-prevRoom, non-trail exits
  } else {
    // All exits are in trail. Try without trail filter (only exclude prevRoom).
    const notPrevRoom = exitEntries.filter(e => e.name !== mem.prevRoom);
    forward = notPrevRoom.length > 0 ? notPrevRoom : exitEntries;
  }

  // Score by bearing closeness + temperature (once — no Math.random per tick)
  const bearingDeg = BEARING_DEG[mem.bearing] ?? 0;
  let best = forward[0];
  let bestScore = -Infinity;

  for (const exit of forward) {
    let angleDiff = Math.abs(bearingDeg - exit.deg);
    if (angleDiff > 180) angleDiff = 360 - angleDiff;
    const base = 180 - angleDiff;
    const score = base + (mem.temperature ?? 0) * 90;
    if (score > bestScore) {
      bestScore = score;
      best = exit;
    }
  }

  return best.dirConst;
}
