/**
 * roles/scout.ts — Colonization scout (multi-phase)
 *
 * Phase 1 — TRAVEL:    route to pre-screened target room
 * Phase 2 — SCORING:   compute base score via scoreRoom()
 * Phase 3 — ADJACENCY: explore each adjacent room, compute source
 *           bonus + claim/own penalties, accumulate modifier
 * Phase 4 — DONE:      write baseScore + modifier to col.candidates
 *
 * If the scout dies at any point during adjacency exploration, the
 * room is never written to candidates — effectively a null score.
 * The death handler auto-blacklists any room that kills the scout
 * within 10 ticks of entry (normal hostile detection).
 */

import type { RoomScore } from '../colonization/scoring';
import { scoreRoom } from '../colonization/scoring';
import { travelToRoom } from '../lib/travel';

type ScoutPhase = 'traveling' | 'scoring' | 'adjacency' | 'done';

interface ScoutMemory {
  role: 'scout';
  targetRoom: string;
  sourceRoom: string;
  respawns: number;
  spawnTick?: number;
  lastRoom?: string;
  route?: Array<{ exit: ExitConstant; room: string }>;
  routeRoom?: string;
  // Multi-phase state
  phase?: ScoutPhase;
  baseScore?: number;
  scoreWorldX?: number;
  scoreWorldY?: number;
  scoreSources?: number;
  scorePositionScore?: number;
  adjacentModifier?: number;
  adjacentRooms?: string[];
  adjacentIndex?: number;
  returningToTarget?: boolean;
  arrivedInAdjacent?: boolean;
  ourUsername?: string;
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

  // Init phase
  if (!mem.phase) mem.phase = 'traveling';

  // ════════════════════════════════════════════════════════
  // Phase 1: TRAVELING — reach the target room
  // ════════════════════════════════════════════════════════
  if (mem.phase === 'traveling') {
    if (creep.room.name !== mem.targetRoom) {
      travelToRoom(creep, mem.targetRoom, false, true);
      return true;
    }
    // Arrived — but if we took too long, the room is too far. Abandon it.
    const age = Game.time - (mem.spawnTick || 0);
    if (age > 550) {
      markDone(col, mem.targetRoom);
      mem.phase = 'done';
      return true;
    }
    mem.phase = 'scoring';
    // fall through
  }

  // ════════════════════════════════════════════════════════
  // Phase 2: SCORING — base score + init adjacency
  // ════════════════════════════════════════════════════════
  if (mem.phase === 'scoring') {
    const result = scoreRoom(creep.room.name, true, true);
    if (!result || result.score <= 0) {
      // Unscoreable — no need for adjacency check
      markDone(col, mem.targetRoom);
      mem.phase = 'done';
      return true;
    }

    mem.baseScore = result.score;
    mem.scoreWorldX = result.worldX;
    mem.scoreWorldY = result.worldY;
    mem.scoreSources = result.sources;
    mem.scorePositionScore = result.positionScore;

    // Get adjacent rooms (no vision needed)
    const exits = Game.map.describeExits(creep.room.name);
    const adjRooms: string[] = [];
    if (exits) {
      for (const _dir in exits) {
        const adj = exits[_dir as keyof typeof exits];
        if (adj && adj !== mem.sourceRoom) adjRooms.push(adj);
      }
    }
    mem.adjacentRooms = adjRooms;
    mem.adjacentIndex = 0;
    mem.adjacentModifier = 0;
    mem.returningToTarget = false;
    mem.arrivedInAdjacent = false;

    // Our username for claim/own checks in adjacent rooms
    const homeRoom = Game.rooms[mem.sourceRoom];
    mem.ourUsername = homeRoom?.controller?.owner?.username;

    if (adjRooms.length === 0) {
      mem.phase = 'done';
    } else {
      mem.phase = 'adjacency';
    }
    return true;
  }

  // ════════════════════════════════════════════════════════
  // Phase 3: ADJACENCY — explore each adjacent room
  // ════════════════════════════════════════════════════════
  if (mem.phase === 'adjacency') {
    const adjRooms = mem.adjacentRooms!;
    const idx = mem.adjacentIndex!;
    if (idx >= adjRooms.length) { mem.phase = 'done'; return true; }
    const adjRoom = adjRooms[idx];

    // ── Returning to target room after exploring ──
    if (mem.returningToTarget) {
      if (creep.room.name !== mem.targetRoom) {
        travelToRoom(creep, mem.targetRoom, false, true);
        return true;
      }
      mem.adjacentIndex = idx + 1;
      mem.returningToTarget = false;
      mem.arrivedInAdjacent = false;
      if (mem.adjacentIndex! >= adjRooms.length) {
        mem.phase = 'done';
      }
      return true;
    }

    // ── Heading into adjacent room ──
    if (creep.room.name !== adjRoom) {
      travelToRoom(creep, adjRoom, false, true);
      return true;
    }

    // Wait one tick for room vision to stabilize
    if (!mem.arrivedInAdjacent) {
      mem.arrivedInAdjacent = true;
      return true;
    }

    // Compute modifier and head back
    const modifier = computeAdjacentModifier(creep, mem);
    mem.adjacentModifier = (mem.adjacentModifier || 0) + modifier;
    mem.returningToTarget = true;
    mem.arrivedInAdjacent = false;
    return true;
  }

  // ════════════════════════════════════════════════════════
  // Phase 4: FINALIZE — write score to leaderboard
  // ════════════════════════════════════════════════════════
  if (mem.phase === 'done') {
    const finalScore = (mem.baseScore || 0) + (mem.adjacentModifier || 0);

    if (finalScore > 0 && mem.scoreWorldX !== undefined) {
      const result: RoomScore = {
        name: mem.targetRoom,
        score: finalScore,
        positionScore: mem.scorePositionScore || 0,
        sources: mem.scoreSources || 0,
        worldX: mem.scoreWorldX,
        worldY: mem.scoreWorldY,
        travelCosts: { sources: [], mineral: 0, controller: 0 },
      };

      col.candidates[mem.targetRoom] = result;
      if (!col.bestRoom || finalScore > col.bestRoom.score) {
        col.bestRoom = {
          name: mem.targetRoom,
          score: finalScore,
          worldX: result.worldX,
          worldY: result.worldY,
        };
      }
    }

    markDone(col, mem.targetRoom);
    return true;
  }

  return true;
}

// ── Helpers ──

/** Compute the adjacent room modifier per Isaac's formula:
 *  sourceBonus = sum(max(0, 100 - pathCost)) for each source
 *  If claimed by third party: sourceBonus *= 0.3
 *  If owned by third party:    sourceBonus -= (RCL*2 - 2) * 100
 */
function computeAdjacentModifier(creep: Creep, mem: ScoutMemory): number {
  const room = creep.room;
  const controller = room.controller;
  const sources = room.find(FIND_SOURCES);

  // Source bonus from scout's entry position to each source
  let sourceBonus = 0;
  for (const source of sources) {
    const path = PathFinder.search(
      creep.pos,
      { pos: source.pos, range: 1 },
      { maxRooms: 1, maxOps: 2000 }
    );
    if (!path.incomplete) {
      sourceBonus += Math.max(0, 100 - path.cost);
    }
  }

  const ourUsername = mem.ourUsername;
  const isOurs = !!(controller?.owner?.username === ourUsername);
  const isInvader = controller?.owner?.username === 'Invader';
  const reservedByUs = controller?.reservation?.username === ourUsername;

  const claimedByOther = !!(controller?.owner && !isOurs && !isInvader) ||
                         !!(controller?.reservation && !reservedByUs && controller.reservation.username !== 'Invader');
  const ownedByOther = !!(controller?.owner && !isOurs && !isInvader);

  if (claimedByOther) {
    sourceBonus = Math.floor(sourceBonus * 0.3);
  }

  if (ownedByOther) {
    const rcl = controller!.level || 0;
    sourceBonus -= (rcl * 2 - 2) * 100;
  }

  return sourceBonus;
}

function markDone(col: any, roomName: string): void {
  if (col.scoutState && col.scoutState[roomName]) {
    col.scoutState[roomName].done = true;
  }
}
