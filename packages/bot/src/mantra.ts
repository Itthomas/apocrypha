/**
 * mantle.ts — Miraak's Mantra recitation (per-room)
 *
 * One creep per room recites ALL fragments of one complete line,
 * then the next creep in that room recites the next line.
 * Cycles through all creeps in the room and all 16 lines.
 *
 * Fragments are ≤10 characters, split at word boundaries.
 */

const LINES: string[][] = [
  ['Here in', 'his shrine'],
  ['That they', 'have', 'forgotten'],
  ['Here do we', 'toil'],
  ['That we', 'might', 'remember'],
  ['By night', 'we reclaim'],
  ['What by', 'day was', 'stolen'],
  ['Far from', 'ourselves'],
  ['He grows', 'ever near', 'to us'],
  ['Our eyes', 'once were', 'blinded'],
  ['Now', 'through', 'him do we', 'see'],
  ['Our hands', 'once were', 'idle'],
  ['Now', 'through', 'them does', 'he speak'],
  ['And when', 'the world', 'shall', 'listen'],
  ['And when', 'the world', 'shall see'],
  ['And when', 'the world', 'remembers'],
  ['That world', 'shall', 'cease to', 'be'],
];

interface MantraState {
  lineIndex: number;
  fragmentIndex: number;
}

export function run(room: Room): void {
  // Only in our rooms
  if (!room.controller?.my) return;

  const creeps = room.find(FIND_MY_CREEPS);
  if (creeps.length === 0) return;

  // Per-room state
  if (!Memory.rooms[room.name]) (Memory.rooms[room.name] as any) = {};
  if (!(Memory.rooms[room.name] as any).mantra) {
    (Memory.rooms[room.name] as any).mantra = { lineIndex: 0, fragmentIndex: 0 };
  }
  const state = (Memory.rooms[room.name] as any).mantra as MantraState;

  const creep = creeps[state.lineIndex % creeps.length];
  const line = LINES[state.lineIndex % LINES.length];
  const fragment = line[state.fragmentIndex];

  creep.say(fragment);

  state.fragmentIndex++;
  if (state.fragmentIndex >= line.length) {
    state.fragmentIndex = 0;
    state.lineIndex = (state.lineIndex + 1) % LINES.length;
  }
}
