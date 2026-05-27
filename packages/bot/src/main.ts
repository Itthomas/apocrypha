/**
 * main.ts — Apocrypha Colony Entry Point
 *
 * Exports the `loop` function called by the Screeps runtime every tick.
 * Routes creeps to their role handlers, manages spawning, and collects telemetry.
 */

import { runHarvester } from './roles/harvester';
import { runBuilder } from './roles/builder';
import { runUpgrader } from './roles/upgrader';
import { runSpawnManager } from './spawnManager';
import { collectStats } from './telemetry';

/**
 * Main game loop. Called by the Screeps runtime on every tick.
 */
export function loop(): void {
  // --- Phase 0: Initialization ---
  // Run once on first tick to initialize memory structures
  if (!Memory.began) {
    Memory.began = true;
    console.log('[apocrypha] Initializing colony...');
  }

  // --- Phase 1: Cleanup ---
  // Clear dead creep memory
  for (const name in Memory.creeps) {
    if (!(name in Game.creeps)) {
      delete Memory.creeps[name];
    }
  }

  // --- Phase 2: Spawning ---
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (room.controller?.my) {
      runSpawnManager(room);
    }
  }

  // --- Phase 3: Creep Logic ---
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    const role = creep.memory.role as string | undefined;

    switch (role) {
      case 'harvester':
        runHarvester(creep);
        break;
      case 'builder':
        runBuilder(creep);
        break;
      case 'upgrader':
        runUpgrader(creep);
        break;
      // Hauler role — TODO: implement when RCL 3+ is reached
      // case 'hauler': runHauler(creep); break;
      default:
        // Unknown role — fall back to harvesting
        console.log(`[warn] Unknown role "${role}" for creep ${name}`);
        creep.say('?');
        runHarvester(creep);
    }
  }

  // --- Phase 4: Telemetry ---
  collectStats();
}
