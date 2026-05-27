/**
 * main.ts — Apocrypha Colony Orchestrator (THIN)
 *
 * Requires individual role/manager modules via Screeps require().
 * Used as: module.exports.loop = function() { ... }
 */

// Screeps module requires
var spawnManager = require('spawnManager');
var telemetry = require('telemetry');
var roleHarvester = require('role.harvester');
var roleHauler = require('role.hauler');
var roleBuilder = require('role.builder');
var roleUpgrader = require('role.upgrader');

// Map role names to module run functions
var roleModules: Record<string, any> | null = null;

function getRoleModule(role: string) {
  if (!roleModules) {
    roleModules = {
      'harvester': roleHarvester,
      'hauler': roleHauler,
      'builder': roleBuilder,
      'upgrader': roleUpgrader,
    };
  }
  return roleModules[role] || null;
}

/** Count creeps by role in a room */
function countHarvesters(room: Room): number {
  var count = 0;
  room.find(FIND_MY_CREEPS).forEach(function(c) {
    if (c.memory.role === 'harvester') count++;
  });
  return count;
}

export function loop(): void {
  // --- Init ---
  if (!Memory.began) {
    Memory.began = true;
    console.log('[apocrypha] Colony online');
  }

  // --- Cleanup dead creep memory ---
  for (var name in Memory.creeps) {
    if (!(name in Game.creeps)) {
      delete Memory.creeps[name];
    }
  }

  // --- Spawning ---
  for (var roomName in Game.rooms) {
    var room = Game.rooms[roomName];
    if (room.controller && room.controller.my) {
      spawnManager.runSpawnManager(room);
    }
  }

  // --- Creep logic with emergency fallback ---
  for (var creepName in Game.creeps) {
    var creep = Game.creeps[creepName];
    var role = creep.memory.role as string | undefined;
    var mod = role ? getRoleModule(role) : null;

    // Emergency: if no harvesters, ANY creep should harvest to keep colony alive
    if (role !== 'harvester' && countHarvesters(creep.room) === 0) {
      roleHarvester.run(creep);
      continue;
    }

    // Normal role dispatch
    var acted = false;
    if (mod && mod.run) {
      acted = mod.run(creep);
    }
    
    // If role couldn't find work, harvest as fallback
    if (!acted && role !== 'harvester') {
      roleHarvester.run(creep);
    }
  }

  // --- Telemetry ---
  telemetry.collectStats();
}
