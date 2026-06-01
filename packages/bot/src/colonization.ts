/**
 * colonization.ts — Global colonization orchestrator
 *
 * Runs every tick from main. Triggers colonization waves when:
 *   1. ownedRooms < GCL level (can claim more rooms)
 *   2. At least one room is RCL 5+
 *   3. Not in cooldown
 *
 * 8 scouts are spawned radially — each targets a room on a 9×9 square
 * centered on the spawn room. Scouts transit to their target via moveTo,
 * then switch to visited-filtered random walk exploration. Shared
 * Memory.colonization.roomsVisited prevents overlap. Scoring runs on
 * every room entered (both phases). On deadline expiry, picks the best
 * scored candidate and triggers the claimer phase (TODO).
 */

const DEADLINE_TICKS = 3000;
const COOLDOWN_TICKS = 10000;

/** 8 offsets on a 9×9 square centered at spawn (corners + cardinals) */
const SCOUT_OFFSETS: Array<[number, number]> = [
  [4, 4], [4, 0], [4, -4],
  [0, -4], [-4, -4], [-4, 0],
  [-4, 4], [0, 4],
];

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
  const col = Memory.colonization;

  // ── Cooldown active ──
  if (col?.cooldownUntil && Game.time < col.cooldownUntil) return;

  // ── Active wave — check deadline expiry ──
  if (col?.active) {
    if (Game.time >= col.deadline) finishWave();
    return;
  }

  // ── Trigger conditions ──
  const ownedRooms = countOwnedRooms();
  if (ownedRooms >= Game.gcl.level) return;

  const spawnRoom = findRcl5Room();
  if (!spawnRoom) return;

  // ── Start new colonization wave ──
  const [sx, sy] = parseRoomXY(spawnRoom.name);
  const scoutTargets = SCOUT_OFFSETS.map(([dx, dy]) => roomName(sx + dx, sy + dy));

  const scoutState: Record<string, any> = {};
  for (let i = 0; i < 8; i++) {
    scoutState[String(i)] = {
      targetRoom: scoutTargets[i],
      phase: 'transit',
      respawns: 0,
      name: '',
      spawnedFrom: spawnRoom.name,
    };
  }

  Memory.colonization = {
    active: true,
    deadline: Game.time + DEADLINE_TICKS,
    cooldownUntil: 0,
    roomsVisited: [spawnRoom.name],
    candidates: {},
    bestRoom: null,
    scoutTargets,
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
  const col = Memory.colonization;
  if (!col) return;

  col.active = false;

  const best = col.bestRoom;
  if (!best) {
    col.cooldownUntil = Game.time + COOLDOWN_TICKS;
    return;
  }

  // Validate minimum threshold
  const candidate = col.candidates[best.name];
  if (!candidate || candidate.sources < 2) {
    col.cooldownUntil = Game.time + COOLDOWN_TICKS;
    return;
  }

  // ── Best room valid — claimer phase ──
  // TODO: spawn CLAIM creep from nearest RCL 5+ room, send to best.name,
  //       build spawn, bootstrap.

  // For now, just cooldown
  col.cooldownUntil = Game.time + COOLDOWN_TICKS;
}
