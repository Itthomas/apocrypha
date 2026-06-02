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

const DEADLINE_TICKS = 3000;
const COOLDOWN_TICKS = 10000;
const SCOUT_GRID_RADIUS = 6;

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

  // ── Scouting: active wave — check deadline expiry ──
  if (col?.active && !col?.phase) {
    if (Game.time >= col.deadline) finishWave();
    return;
  }

  // ── Trigger conditions for new scouting wave ──
  const ownedRooms = countOwnedRooms();
  if (ownedRooms >= Game.gcl.level) return;

  const spawnRoom = findRcl5Room();
  if (!spawnRoom) return;

  // ── Start new scouting wave ──
  const [sx, sy] = parseRoomXY(spawnRoom.name);

  // Generate ±6 grid and pre-screen for blueprint viability
  const eligibleRooms: string[] = [];
  for (let dx = -SCOUT_GRID_RADIUS; dx <= SCOUT_GRID_RADIUS; dx++) {
    for (let dy = -SCOUT_GRID_RADIUS; dy <= SCOUT_GRID_RADIUS; dy++) {
      const name = roomName(sx + dx, sy + dy);
      if (name === spawnRoom.name) continue; // skip source room
      try {
        if (canFitBlueprint(name)) {
          eligibleRooms.push(name);
        }
      } catch (_e) {
        // Room doesn't exist (e.g. outside world bounds) — skip
      }
    }
  }

  if (eligibleRooms.length === 0) {
    console.log(`[colonization] No eligible rooms in ±${SCOUT_GRID_RADIUS} grid`);
    Memory.colonization = { cooldownUntil: Game.time + COOLDOWN_TICKS } as any;
    return;
  }

  const scoutState: Record<string, any> = {};
  for (const room of eligibleRooms) {
    scoutState[room] = {
      targetRoom: room,
      respawns: 0,
      name: '',
      spawnedFrom: spawnRoom.name,
    };
  }

  console.log(`[colonization] Pre-screened ${eligibleRooms.length} rooms — scouting wave begins`);

  Memory.colonization = {
    active: true,
    deadline: Game.time + DEADLINE_TICKS,
    cooldownUntil: 0,
    candidates: {},
    bestRoom: null,
    scoutTargets: eligibleRooms,
    scoutState,
  } as any;
}

// ── Helpers ──

function countOwnedRooms(): number {
  let count = 0;
  for (const _rn in Game.rooms) {
    const room = Game.rooms[_rn];
    if (room.controller?.my) count++;
  }
  return count;
}

function findRcl5Room(): Room | null {
  for (const _rn in Game.rooms) {
    const room = Game.rooms[_rn];
    if (room.controller?.my && (room.controller.level ?? 0) >= 5) return room;
  }
  return null;
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
  const sourceRoom = findRcl5Room();
  if (!sourceRoom) {
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
    sourceRoom: sourceRoom.name,
  };
  col.bestRoom = best;

  console.log(`[colonization] Scouting complete — claiming ${best.name} (score ${best.score}) from ${sourceRoom.name}`);
}
