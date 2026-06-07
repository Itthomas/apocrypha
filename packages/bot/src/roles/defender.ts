/**
 * roles/defender.ts — Remote room defender
 *
 * Lightweight combat creep for remote room defense — same priority-ladder
 * targeting as the attacker, but with a smaller body (max 5 blocks) for
 * faster spawning. Delegates all combat logic to the attacker module.
 */

import { run as attackerRun } from './attacker';

export function run(creep: Creep): boolean {
  return attackerRun(creep);
}
