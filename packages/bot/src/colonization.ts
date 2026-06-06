/**
 * colonization.ts — Global colonization orchestrator
 *
 * Phases: scouting → claiming → building → complete
 *
 * Scouting: pre-screens a ±6 room grid around the RCL 5+ source room
 *   using terrain-only blueprint viability checks (no vision needed).
 *   One scout per eligible room travels directly to its target,
 *   scores it, and saves results to the shared leaderboard.
 *
 * Claiming: spawn a claimer creep to claim the controller and
 *   place the spawn construction site.
 *
 * Building: spawn colony-builder creeps that travel to the target
 *   room and run survivor behavior to build the spawn.
 *
 * Complete: source room stops sending builders. Existing builders
 *   finish their natural lives. Cooldown prevents immediate re-wave.
 */

import { canFitBlueprint } from './colonization/scoring';
import { isHallway } from './lib/travel';

const DEADLINE_TICKS = 3000;
const COOLDOWN_TICKS = 10000;
const SCOUT_GRID_RADIUS = 4;

// ── Room name helpers ──

function parseRoomXY(name: string): [number, number] {
  const match = name.match(/^([WE])(\d+)([NS])(\d+)$/);
  if (!match) return [0, 0];
  const x = (match[1] === 'W' ? -1 : 1) * parseInt(match[2], 10);
  const y = (match[3] === 'N' ? 1 : -1) * parseInt(match[4], 10);
  return [x, y];
}

function roomName(x: number, y: number): string {
  const ew = (x >= 0 ? 'E' : 'W') + Math.abs(x);
  const ns = (y >= 0 ? 'N' : 'S') + Math.abs(y);
  return ew + ns;
}

export function runColonization(): void {
  const col = Memory.colonization as any;

  // ── Cooldown active ──
  if (col?.cooldownUntil && Game.time < col.cooldownUntil) return;

  // ── Phase: complete — clean up after cooldown expires ──
  if (col?.phase === 'complete') {
    if (Game.time >= col.cooldownUntil) {
      console.log(`[colonization] Cooldown expired — cycle complete, cleaning up`);
      delete (Memory as any).colonization;
    }
    return;
  }

  // ── Phase: building — check if spawn is built in target room ──
  if (col?.phase === 'building') {
    const targetRoom = Game.rooms[col.claimTarget?.room];
    if (targetRoom) {
      const spawns = targetRoom.find(FIND_MY_SPAWNS);
      if (spawns.length > 0) {
        col.phase = 'complete';
        col.cooldownUntil = Game.time + COOLDOWN_TICKS;
        console.log(`[colonization] ✓ Spawn built in ${col.claimTarget.room} — phase complete`);
        return;
      }
    }
    return;
  }

  // ── Phase: claiming — check if claimer has placed spawn site ──
  if (col?.phase === 'claiming') {
    const targetRoom = Game.rooms[col.claimTarget?.room];
    if (targetRoom) {
      const sites = targetRoom.find(FIND_MY_CONSTRUCTION_SITES);
      if (sites.length > 0) {
        col.phase = 'building';
        console.log(`[colonization] Spawn site placed in ${col.claimTarget.room} — phase building`);
        return;
      }
    }
    return;
  }

  // ── Scouting: active wave — check if all rooms scored or deadline expired ──
  if (col?.active && !col?.phase) {
    if (Game.time >= col.deadline) { finishWave(); return; }
    const perRoom = col.scoutTargets as Record<string, string[]> | undefined;
    if (perRoom) {
      const allTargets = Object.keys(perRoom).reduce((flat: string[], src: string) => flat.concat(perRoom[src]), []);
      if (allTargets.length > 0 && allTargets.every((r: string) => {
        const s = col.scoutState?.[r];
        return s?.done || (s?.respawns >= 5);
      })) {
        finishWave();
      }
    }
    return;
  }

  // ── Trigger conditions for new scouting wave ──
  const ownedRooms = countOwnedRooms();
  if (ownedRooms >= Game.gcl.level) return;

  const sourceRooms = getRcl5Rooms();
  if (sourceRooms.length === 0) return;

  const owned = getOwnedRoomNames();

  // ── Per-room candidate generation with conflict resolution ──
  // Assignment map: candidate room → { sourceRoom, cost }
  // When two source rooms claim the same candidate, the closer one wins
  // (by findRoute room count).
  const assignment: Record<string, { sourceRoom: string }> = {};

  for (const srcRoom of sourceRooms) {
    const zoneStatus = Game.map.getRoomStatus(srcRoom.name).status;
    const [sx, sy] = parseRoomXY(srcRoom.name);

    for (let dx = -SCOUT_GRID_RADIUS; dx <= SCOUT_GRID_RADIUS; dx++) {
      for (let dy = -SCOUT_GRID_RADIUS; dy <= SCOUT_GRID_RADIUS; dy++) {
        const rx = sx + dx, ry = sy + dy;
        const name = roomName(rx, ry);
        if (name === srcRoom.name) continue;
        if (isHighwayOrCenter(rx, ry)) continue;
        if (owned.has(name)) continue;

        // Zone compatibility
        try {
          const candStatus = Game.map.getRoomStatus(name).status;
          if (zoneStatus === 'respawn' && candStatus !== 'respawn' && !isHallway(name)) continue;
          if (zoneStatus === 'novice' && candStatus !== 'novice' && !isHallway(name)) continue;
          if (zoneStatus === 'normal' && (candStatus === 'respawn' || candStatus === 'novice')) continue;
        } catch (_e) { continue; }

        // Blueprint viability
        try { if (!canFitBlueprint(name)) continue; }
        catch (_e) { continue; }

        // Already assigned: keep the closer source room
        const existing = assignment[name];
        if (existing) {
          // Tie-break by route distance. findRoute is room-level BFS — cheap.
          const prevRoute = Game.map.findRoute(existing.sourceRoom, name);
          const prevCost = prevRoute === ERR_NO_PATH ? Infinity : prevRoute.length;
          const newRoute = Game.map.findRoute(srcRoom.name, name);
          const newCost = newRoute === ERR_NO_PATH ? Infinity : newRoute.length;
          if (newCost < prevCost) {
            assignment[name] = { sourceRoom: srcRoom.name };
          }
        } else {
          assignment[name] = { sourceRoom: srcRoom.name };
        }
      }
    }
  }

  if (Object.keys(assignment).length === 0) {
    console.log(`[colonization] No eligible rooms in ±${SCOUT_GRID_RADIUS} grid`);
    Memory.colonization = { cooldownUntil: Game.time + COOLDOWN_TICKS } as any;
    return;
  }

  // ── Build per-room scoutTargets and scoutState ──
  const scoutTargets: Record<string, string[]> = {};
  const scoutState: Record<string, any> = {};

  for (const candName of Object.keys(assignment)) {
    const src = assignment[candName].sourceRoom;
    if (!scoutTargets[src]) scoutTargets[src] = [];
    scoutTargets[src].push(candName);

    // scoutState already uses spawnedFrom for the source room
    scoutState[candName] = {
      targetRoom: candName,
      respawns: 0,
      name: '',
      spawnedFrom: src,
    };
  }

  const totalTargets = Object.keys(assignment).length;
  const sourceList = Object.keys(scoutTargets).join(', ');
  console.log(`[colonization] ${totalTargets} targets from ${sourceRooms.length} source rooms (${sourceList}) — scouting wave begins`);

  Memory.colonization = {
    active: true,
    deadline: Game.time + DEADLINE_TICKS,
    cooldownUntil: 0,
    candidates: {},
    bestRoom: null,
    scoutTargets,
    scoutState,
  } as any;
}

// ── Helpers ──

/** Check if a room is a highway (x or y % 10 == 0) or sector center (x and y within ±1 of %10==5) */
function isHighwayOrCenter(x: number, y: number): boolean {
  const ax = Math.abs(x), ay = Math.abs(y);
  // Highways: rooms where x % 10 == 0 or y % 10 == 0
  if (ax % 10 === 0 || ay % 10 === 0) return true;
  // Sector center: the 9 rooms centered on (x%10==5, y%10==5)
  const rx = ax % 10, ry = ay % 10;
  if (rx >= 4 && rx <= 6 && ry >= 4 && ry <= 6) return true;
  return false;
}

/** Collect names of rooms we already control */
function getOwnedRoomNames(): Set<string> {
  const owned = new Set<string>();
  for (const _rn in Game.rooms) {
    const room = Game.rooms[_rn];
    if (room.controller?.my) owned.add(room.name);
  }
  return owned;
}

function countOwnedRooms(): number {
  let count = 0;
  for (const _rn in Game.rooms) {
    const room = Game.rooms[_rn];
    if (room.controller?.my) count++;
  }
  return count;
}

function getRcl5Rooms(): Room[] {
  const rooms: Room[] = [];
  for (const _rn in Game.rooms) {
    const room = Game.rooms[_rn];
    if (room.controller?.my && (room.controller.level ?? 0) >= 5) rooms.push(room);
  }
  return rooms;
}

// ── Wave completion ──

function finishWave(): void {
  const col = Memory.colonization as any;
  if (!col) return;

  const best = col.bestRoom;
  if (!best) {
    col.cooldownUntil = Game.time + COOLDOWN_TICKS;
    delete col.active;
    return;
  }

  const candidate = col.candidates[best.name];
  if (!candidate || candidate.sources < 2) {
    col.cooldownUntil = Game.time + COOLDOWN_TICKS;
    delete col.active;
    return;
  }

  // ── Best room valid — transition to claimer phase ──
  // Use the source room that dispatched the winning scout
  const state = col.scoutState?.[best.name];
  if (!state?.spawnedFrom) {
    col.cooldownUntil = Game.time + COOLDOWN_TICKS;
    delete col.active;
    return;
  }

  col.phase = 'claiming';
  col.active = true;
  delete col.scoutState;
  delete col.scoutTargets;
  col.claimTarget = {
    room: best.name,
    spawnX: best.worldX,
    spawnY: best.worldY,
    sourceRoom: state.spawnedFrom,
  };
  col.bestRoom = best;

  console.log(`[colonization] Scouting complete — claiming ${best.name} (score ${best.score}) from ${state.spawnedFrom}`);
}
