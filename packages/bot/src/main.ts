/**
 * main.ts — Apocrypha Colony Orchestrator (THIN)
 *
 * Requires individual role/manager modules via Screeps require().
 * Used as: module.exports.loop = function() { ... }
 */

// Screeps module requires
var spawnManager = require('spawnManager');
var telemetry = require('telemetry');
var constructionPlanner = require('constructionPlanner');
var roleMiner = require('role.miner');
var roleHauler = require('role.hauler');
var roleBuilder = require('role.builder');
var roleUpgrader = require('role.upgrader');
var roleSurvivor = require('role.survivor');
var mantra = require('mantra');
var tower = require('tower');

// Map role names to module run functions
var roleModules: Record<string, any> | null = null;

function getRoleModule(role: string) {
  if (!roleModules) {
    roleModules = {
      'miner': roleMiner,
      'hauler': roleHauler,
      'builder': roleBuilder,
      'upgrader': roleUpgrader,
      'survivor': roleSurvivor,
    };
  }
  return roleModules[role] || null;
}

/** Count creeps by role in a room */
function countMiners(room: Room): number {
  var count = 0;
  room.find(FIND_MY_CREEPS).forEach(function(c) {
    if (c.memory.role === 'miner' || c.memory.role === 'survivor') count++;
  });
  return count;
}

export function loop(): void {
  // --- Init ---
  if (!Memory.began) {
    Memory.began = true;
    console.log('[apocrypha] Colony online');
  }

  // --- Cleanup dead creep memory (log before deleting) ---
  for (var name in Memory.creeps) {
    if (!(name in Game.creeps)) {
      telemetry.logCreepDeath(name, Memory.creeps[name]);
      delete Memory.creeps[name];
    }
  }

  // --- Construction planning ---
  for (var roomName in Game.rooms) {
    var room = Game.rooms[roomName];
    if (room.controller && room.controller.my) {
      constructionPlanner.runConstructionPlanner(room);
      tower.runTowers(room);
    }
  }

  // --- Spawning ---
  for (var roomName2 in Game.rooms) {
    var room2 = Game.rooms[roomName2];
    if (room2.controller && room2.controller.my) {
      spawnManager.runSpawnManager(room2);
    }
  }

  // --- Creep logic with emergency fallback ---
  for (var creepName in Game.creeps) {
    var creep = Game.creeps[creepName];
    var role = creep.memory.role as string | undefined;
    var mod = role ? getRoleModule(role) : null;

    // Emergency: if no miners, non-hauler creeps harvest to keep colony alive.
    // Haulers are skipped — they have no WORK parts and rely on container withdrawal.
    if (role !== 'miner' && role !== 'hauler' && countMiners(creep.room) === 0) {
      roleSurvivor.run(creep);
      continue;
    }

    // Normal role dispatch
    var acted = false;
    if (mod && mod.run) {
      acted = mod.run(creep);
    }
    
    // If role couldn't find work, harvest as fallback
    if (!acted && role !== 'miner') {
      roleSurvivor.run(creep);
    }
  }

  // --- Telemetry ---
  telemetry.collectStats();

  // --- Log cleanup (every 10k ticks) ---
  telemetry.cleanCreepLog();

  // --- Mantra ---
  mantra.run();
}
