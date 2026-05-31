/**
 * colonization.ts — Global colonization orchestrator
 *
 * Runs every tick from main. Triggers colonization waves when:
 *   1. ownedRooms < GCL level (can claim more rooms)
 *   2. At least one room is RCL 5+
 *   3. Not in cooldown
 *
 * Creates Memory.colonization with a 3,000-tick scouting deadline.
 * On expiry, picks the best scored candidate and triggers the claimer
 * phase (TODO).
 */

const DEADLINE_TICKS = 3000;
const COOLDOWN_TICKS = 10000;

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

  if (!hasRcl5Room()) return;

  // ── Start new colonization wave ──
  Memory.colonization = {
    active: true,
    deadline: Game.time + DEADLINE_TICKS,
    cooldownUntil: 0,
    roomsVisited: [],
    candidates: {},
    bestRoom: null,
    nextBearing: 0,
    scoutState: {},
  };
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

function hasRcl5Room(): boolean {
  for (const _rn in Game.rooms) {
    const room = Game.rooms[_rn];
    if (room.controller?.my && (room.controller.level ?? 0) >= 5) return true;
  }
  return false;
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
