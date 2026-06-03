/**
 * roles/scout.ts — Colonization scout (single-phase)
 *
 * Travels directly to a pre-screened target room using findRoute
 * exit-by-exit routing. Scores the room on arrival and saves results
 * to the shared Memory.colonization leaderboard. No random walk,
 * no explore phase — one room, one score.
 */

import { scoreRoom } from '../colonization/scoring';
import { travelToRoom } from '../lib/travel';

interface ScoutMemory {
  role: 'scout';
  targetRoom: string;
  sourceRoom: string;
  respawns: number;
  lastRoom?: string;
  route?: Array<{ exit: ExitConstant; room: string }>;
  routeRoom?: string;
}

export function run(creep: Creep): boolean {
  const mem = creep.memory as ScoutMemory;
  const col = Memory.colonization as any;
  if (!col?.active || Game.time >= col.deadline) {
    return false;
  }

  // Track room immediately — if we die before the end of this tick,
  // the death handler needs the correct room for hostile marking.
  mem.lastRoom = creep.room.name;

  // ── Edge override: move toward room center if on the boundary ──
  const pos = creep.pos;
  if (pos.x === 0 || pos.x === 49 || pos.y === 0 || pos.y === 49) {
    creep.moveTo(new RoomPosition(25, 25, creep.room.name), { maxRooms: 1 });
    return true;
  }

  const roomName = creep.room.name;

  // ── Not in target room yet → route there ──
  if (roomName !== mem.targetRoom) {
    travelToRoom(creep, mem.targetRoom);
    return true;
  }

  // ── In target room — score it ──
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

  // Mark room as scored so we don't respawn another scout for it
  if (col.scoutState && col.scoutState[roomName]) {
    col.scoutState[roomName].done = true;
  }

  return true;
}
