/**
 * mantle.ts — Miraak's Mantra recitation
 *
 * Each tick, one creep speaks one fragment of the mantra.
 * Cycles through all creeps in order, then advances to the next fragment.
 * When the mantra completes, it loops from the beginning.
 *
 * Fragments are ≤10 characters, split at word boundaries.
 * Original mantra: 16 lines → 48 fragments.
 */

// Pointer state stored in Memory
interface MantraState {
  /** Index into the fragments array */
  fragmentIndex: number;
}

const FRAGMENTS: string[] = [
  // 1. Here in his shrine
  'Here in', 'his shrine',
  // 2. That they have forgotten
  'That they', 'have', 'forgotten',
  // 3. Here do we toil
  'Here do we', 'toil',
  // 4. That we might remember
  'That we', 'might', 'remember',
  // 5. By night we reclaim
  'By night', 'we reclaim',
  // 6. What by day was stolen
  'What by', 'day was', 'stolen',
  // 7. Far from ourselves
  'Far from', 'ourselves',
  // 8. He grows ever near to us
  'He grows', 'ever near', 'to us',
  // 9. Our eyes once were blinded
  'Our eyes', 'once were', 'blinded',
  // 10. Now through him do we see
  'Now', 'through', 'him do we', 'see',
  // 11. Our hands once were idle
  'Our hands', 'once were', 'idle',
  // 12. Now through them does he speak
  'Now', 'through', 'them does', 'he speak',
  // 13. And when the world shall listen
  'And when', 'the world', 'shall', 'listen',
  // 14. And when the world shall see
  'And when', 'the world', 'shall see',
  // 15. And when the world remembers
  'And when', 'the world', 'remembers',
  // 16. That world shall cease to be
  'That world', 'shall', 'cease to', 'be',
];

export function run(): void {
  if (!Memory.mantra) {
    Memory.mantra = { fragmentIndex: 0 };
  }

  const state = Memory.mantra as MantraState;
  const creepNames = Object.keys(Game.creeps);
  if (creepNames.length === 0) return;

  // Pick the next creep: use fragmentIndex to cycle through all creeps
  const creepIndex = state.fragmentIndex % creepNames.length;
  const creep = Game.creeps[creepNames[creepIndex]];
  const fragment = FRAGMENTS[state.fragmentIndex % FRAGMENTS.length];

  if (creep) {
    creep.say(fragment);
  }

  // Advance for next tick
  state.fragmentIndex = (state.fragmentIndex + 1) % (FRAGMENTS.length * creepNames.length);
}
