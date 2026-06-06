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

var roleSurvivor = require('role.survivor');
var roleScout = require('role.scout');
var roleClaimer = require('role.claimer');
var roleColonyBuilder = require('role.colonyBuilder');
var roleAttacker = require('role.attacker');
var roleAttrition = require('role.attrition');
var roleRemoteScout = require('role.remoteScout');
var roleReserver = require('role.reserver');
var roleRemoteWorker = require('role.remoteWorker');
var mantra = require('mantra');
var tower = require('tower');
var colonization = require('colonization');
var remoteHarvesting = require('remoteHarvesting');
var libTravel = require('lib.travel');

// Map role names to module run functions
var roleModules: Record<string, any> | null = null;

function getRoleModule(role: string) {
  if (!roleModules) {
    roleModules = {
      'miner': roleMiner,
      'hauler': roleHauler,

      'survivor': roleSurvivor,
      'scout': roleScout,
      'claimer': roleClaimer,
      'colonyBuilder': roleColonyBuilder,
      'attacker': roleAttacker,
      'attrition': roleAttrition,
      'remoteScout': roleRemoteScout,
      'reserver': roleReserver,
      'remoteWorker': roleRemoteWorker,
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

  // --- Cleanup dead creep memory + mark hostile rooms on death ---
  for (var name in Memory.creeps) {
    if (!(name in Game.creeps)) {
      var mem = Memory.creeps[name];
      telemetry.logCreepDeath(name, mem);

      // If a traveler was killed shortly after entering a room, blacklist it.
      // This catches border ambushes (tower fire, keeper lairs) without
      // permanently routing around rooms a creep passed through peacefully.
      var role = mem.role as string | undefined;
      if (role && (role === 'scout' || role === 'claimer' || role === 'colonyBuilder' || role === 'attacker' || role === 'attrition' || role === 'remoteScout' || role === 'reserver' || role === 'remoteWorker')) {
        var lastRoom = mem.lastRoom as string | undefined;
        var enteredRoomTick = mem.enteredRoomTick as number | undefined;
        var ambushed = enteredRoomTick ? (Game.time - enteredRoomTick <= 10) : false;
        // Never blacklist hallways — they're mandatory transit corridors
        if (ambushed && lastRoom && !libTravel.isHallway(lastRoom)) {
          var room = Game.rooms[lastRoom];
          if (room) {
            var hostiles = room.find(FIND_HOSTILE_CREEPS);
            if (hostiles.length === 0) hostiles = room.find(FIND_HOSTILE_STRUCTURES);
            if (hostiles.length > 0) {
              if (!Memory.hostileRooms) Memory.hostileRooms = {};
              (Memory.hostileRooms as any)[lastRoom] = Game.time;
            }
          } else {
            // No vision — the room killed us before we could see what's there
            if (!Memory.hostileRooms) Memory.hostileRooms = {};
            (Memory.hostileRooms as any)[lastRoom] = Game.time;
          }
        }
      }

      delete Memory.creeps[name];
    }
  }

  // --- Construction planning ---
  for (var roomName in Game.rooms) {
    var room = Game.rooms[roomName];
    if (room.controller && room.controller.my) {
      constructionPlanner.runConstructionPlanner(room);
      tower.runTowers(room);
      mantra.run(room);
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
    if (role !== 'miner' && role !== 'hauler' && role !== 'scout' && role !== 'claimer' && role !== 'colonyBuilder' && role !== 'attacker' && role !== 'attrition' && role !== 'remoteScout' && role !== 'reserver' && role !== 'remoteWorker' && countMiners(creep.room) === 0) {
      roleSurvivor.run(creep);
      continue;
    }

    // Normal role dispatch
    var acted = false;
    if (mod && mod.run) {
      acted = mod.run(creep);
    }
    
    // If role couldn't find work, harvest as fallback.
    // Scouts are excluded — they either explore or stand still.
    if (!acted && role !== 'miner' && role !== 'scout' && role !== 'claimer' && role !== 'colonyBuilder' && role !== 'attacker' && role !== 'attrition' && role !== 'remoteScout' && role !== 'reserver' && role !== 'remoteWorker') {
      roleSurvivor.run(creep);
    }
  }

  // --- Telemetry ---
  telemetry.collectStats();

  // --- Log cleanup (every 10k ticks) ---
  telemetry.cleanCreepLog();

  // --- Colonization ---
  colonization.runColonization();

  // --- Remote harvesting ---
  remoteHarvesting.runRemoteHarvesting();

  // --- Mantra ---
  // (runs per-room in the construction loop above)
}
