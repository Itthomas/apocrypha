/* Apocrypha — built 2026-05-27T21:09:07.170Z */
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// packages/bot/src/main.ts
var main_exports = {};
__export(main_exports, {
  loop: () => loop
});
module.exports = __toCommonJS(main_exports);

// packages/bot/src/telemetry/types.ts
var STATS_INTERVAL = 20;

// packages/bot/src/telemetry/index.ts
var harvestWindow = {};
var spendWindow = {};
function trackHarvest(roomName, amount) {
  harvestWindow[roomName] = (harvestWindow[roomName] || 0) + amount;
}
function trackSpawnSpend(roomName, amount) {
  spendWindow[roomName] = (spendWindow[roomName] || 0) + amount;
}
function getCreepCensus(room) {
  const byRole = {};
  const creeps = room.find(FIND_MY_CREEPS);
  for (const creep of creeps) {
    const role = creep.memory.role ?? "unknown";
    byRole[role] = (byRole[role] || 0) + 1;
  }
  return { total: creeps.length, byRole };
}
function getRoomEnergy(room) {
  const stored = room.energyAvailable;
  const capacity = room.energyCapacityAvailable;
  const harvested = harvestWindow[room.name] || 0;
  const spent = spendWindow[room.name] || 0;
  harvestWindow[room.name] = 0;
  spendWindow[room.name] = 0;
  return { available: stored, capacity, harvested, spent };
}
function getStructureCounts(room) {
  const counts = {};
  const structures = room.find(FIND_STRUCTURES);
  for (const s of structures) {
    counts[s.structureType] = (counts[s.structureType] || 0) + 1;
  }
  return counts;
}
function getRoomStats(room) {
  const controller = room.controller;
  const energy = getRoomEnergy(room);
  const creeps = getCreepCensus(room);
  const constructionSites = room.find(FIND_CONSTRUCTION_SITES).length;
  const structures = getStructureCounts(room);
  let etaTicks = null;
  if (controller && controller.progress > 0 && controller.level < 8) {
    const remaining = controller.progressTotal - controller.progress;
    const progressPerTick = controller.progress / (Game.time - (Memory.stats?.tick || Game.time - STATS_INTERVAL));
    etaTicks = progressPerTick > 0 ? Math.ceil(remaining / progressPerTick) : null;
  }
  return {
    name: room.name,
    rcl: controller?.level ?? 0,
    energy,
    creeps,
    controller: {
      level: controller?.level ?? 0,
      progress: controller?.progress ?? 0,
      progressTotal: controller?.progressTotal ?? 0,
      etaTicks
    },
    constructionSites,
    structures
  };
}
function collectStats() {
  if (Game.time % STATS_INTERVAL !== 0) return;
  const roomStats = {};
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (room.controller?.my) {
      roomStats[roomName] = getRoomStats(room);
    }
  }
  const stats = {
    tick: Game.time,
    time: Date.now(),
    cpu: {
      bucket: Game.cpu.bucket,
      limit: Game.cpu.limit,
      used: Game.cpu.getUsed()
    },
    gcl: {
      level: Game.gcl.level,
      progress: Game.gcl.progress,
      progressTotal: Game.gcl.progressTotal
    },
    rooms: roomStats
  };
  Memory.stats = stats;
}

// packages/bot/src/roles/harvester.ts
function assignSource(creep) {
  const room = creep.room;
  const sources = room.find(FIND_SOURCES);
  if (sources.length === 0) return null;
  const harvesters = room.find(FIND_MY_CREEPS).filter((c) => c.memory.role === "harvester");
  const counts = /* @__PURE__ */ new Map();
  for (const s of sources) counts.set(s.id, 0);
  for (const h of harvesters) {
    const sid = h.memory.sourceId;
    if (sid) counts.set(sid, (counts.get(sid) || 0) + 1);
  }
  let best = null;
  let bestCount = Infinity;
  for (const s of sources) {
    const c = counts.get(s.id) || 0;
    if (c < bestCount) {
      bestCount = c;
      best = s;
    }
  }
  return best?.id ?? null;
}
function runHarvester(creep) {
  const mem = creep.memory;
  if (creep.store.getFreeCapacity() === 0) {
    mem.harvesting = false;
  }
  if (creep.store.getUsedCapacity() === 0) {
    mem.harvesting = true;
  }
  if (!mem.harvesting) {
    const target = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
      filter: (s) => (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
    });
    if (target) {
      if (creep.transfer(target, RESOURCE_ENERGY) === -9) {
        creep.moveTo(target, { visualizePathStyle: { stroke: "#ffaa00" } });
      }
      return true;
    }
    if (creep.room.controller) {
      if (creep.upgradeController(creep.room.controller) === -9) {
        creep.moveTo(creep.room.controller, { visualizePathStyle: { stroke: "#ffffff" } });
      }
      return true;
    }
    return false;
  }
  if (!mem.sourceId) {
    mem.sourceId = assignSource(creep);
  }
  const source = Game.getObjectById(mem.sourceId);
  if (!source) {
    mem.sourceId = assignSource(creep);
    return true;
  }
  const result = creep.harvest(source);
  if (result === -9) {
    creep.moveTo(source, { visualizePathStyle: { stroke: "#ffaa00" } });
  } else if (result === 0) {
    trackHarvest(creep.room.name, creep.getActiveBodyparts(WORK) * 2);
  }
  return true;
}

// packages/bot/src/roles/builder.ts
function runBuilder(creep) {
  const mem = creep.memory;
  if (creep.store.getFreeCapacity() === 0) {
    mem.building = true;
  }
  if (creep.store.getUsedCapacity() === 0) {
    mem.building = false;
    mem.targetId = void 0;
  }
  if (mem.building) {
    let target = null;
    if (mem.targetId) {
      target = Game.getObjectById(mem.targetId);
    }
    if (!target) {
      target = creep.pos.findClosestByPath(FIND_CONSTRUCTION_SITES);
      if (!target) {
        target = creep.pos.findClosestByPath(FIND_STRUCTURES, {
          filter: (s) => s.hits < s.hitsMax * 0.5
        });
      }
    }
    if (!target) {
      if (creep.room.controller) {
        if (creep.upgradeController(creep.room.controller) === -9) {
          creep.moveTo(creep.room.controller);
        }
      }
      return true;
    }
    mem.targetId = target.id;
    let result;
    if (target instanceof ConstructionSite) {
      result = creep.build(target);
    } else {
      result = creep.repair(target);
    }
    if (result === -9) {
      creep.moveTo(target, { visualizePathStyle: { stroke: "#00ff00" } });
    } else if (result === 0) {
      if (target instanceof ConstructionSite && !Game.getObjectById(target.id) || target instanceof Structure && target.hits >= target.hitsMax) {
        mem.targetId = void 0;
      }
    }
    return true;
  }
  const spawnOrExt = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
    filter: (s) => (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) && s.store.getUsedCapacity(RESOURCE_ENERGY) > 0
  });
  if (spawnOrExt) {
    if (creep.withdraw(spawnOrExt, RESOURCE_ENERGY) === -9) {
      creep.moveTo(spawnOrExt);
    }
    return true;
  }
  return false;
}

// packages/bot/src/roles/upgrader.ts
function runUpgrader(creep) {
  const mem = creep.memory;
  if (creep.store.getFreeCapacity() === 0) {
    mem.upgrading = true;
  }
  if (creep.store.getUsedCapacity() === 0) {
    mem.upgrading = false;
  }
  if (mem.upgrading) {
    const controller = creep.room.controller;
    if (controller) {
      const result = creep.upgradeController(controller);
      if (result === -9) {
        creep.moveTo(controller, { visualizePathStyle: { stroke: "#ffffff" } });
      }
      return true;
    }
    return false;
  }
  let target = null;
  const spawnOrExt = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
    filter: (s) => (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) && s.store.getUsedCapacity(RESOURCE_ENERGY) > 0
  });
  if (spawnOrExt) {
    target = spawnOrExt;
  }
  if (!target) {
    const container = creep.pos.findClosestByPath(FIND_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_CONTAINER && s.store.getUsedCapacity(RESOURCE_ENERGY) > 0
    });
    if (container) target = container;
  }
  if (!target) {
    const dropped = creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
      filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount >= 50
    });
    if (dropped) target = dropped;
  }
  if (!target) {
    if (creep.room.controller) {
      creep.moveTo(creep.room.controller);
    }
    return false;
  }
  if (target instanceof Resource) {
    if (creep.pickup(target) === -9) {
      creep.moveTo(target);
    }
  } else {
    if (creep.withdraw(target, RESOURCE_ENERGY) === -9) {
      creep.moveTo(target);
    }
  }
  return true;
}

// packages/bot/src/spawnManager.ts
function getSpawnQuotas(room) {
  const rcl = room.controller?.level ?? 0;
  const energyCap = room.energyCapacityAvailable;
  const energyAvail = room.energyAvailable;
  const BODY_BASE_COST = BODYPART_COST[WORK] + BODYPART_COST[CARRY] + BODYPART_COST[MOVE];
  const buildBody = (work) => {
    const parts = [];
    for (let i = 0; i < work; i++) parts.push(WORK);
    for (let i = 0; i < work; i++) parts.push(CARRY);
    for (let i = 0; i < work; i++) parts.push(MOVE);
    return parts;
  };
  const tiers = Math.min(Math.floor(energyAvail / BODY_BASE_COST), Math.floor(energyCap / BODY_BASE_COST));
  const safeTiers = Math.max(1, tiers);
  const quotas = [];
  switch (rcl) {
    case 0:
    case 1:
      quotas.push({ role: "harvester", body: buildBody(Math.min(safeTiers, 2)), minimum: 2, maximum: 4 });
      break;
    case 2:
      quotas.push({ role: "harvester", body: buildBody(Math.min(safeTiers, 3)), minimum: 2, maximum: 4 });
      quotas.push({ role: "builder", body: buildBody(Math.min(safeTiers, 3)), minimum: 1, maximum: 3 });
      quotas.push({ role: "upgrader", body: buildBody(Math.min(safeTiers, 2)), minimum: 1, maximum: 2 });
      break;
    case 3:
      quotas.push({ role: "harvester", body: buildBody(Math.min(safeTiers, 4)), minimum: 2, maximum: 4 });
      quotas.push({ role: "hauler", body: buildBody(Math.min(safeTiers, 3)), minimum: 1, maximum: 3 });
      quotas.push({ role: "builder", body: buildBody(Math.min(safeTiers, 3)), minimum: 1, maximum: 2 });
      quotas.push({ role: "upgrader", body: buildBody(Math.min(safeTiers, 4)), minimum: 1, maximum: 3 });
      break;
    case 4:
    case 5:
      quotas.push({ role: "harvester", body: buildBody(Math.min(safeTiers, 5)), minimum: 2, maximum: 4 });
      quotas.push({ role: "hauler", body: buildBody(Math.min(safeTiers, 4)), minimum: 2, maximum: 4 });
      quotas.push({ role: "builder", body: buildBody(Math.min(safeTiers, 4)), minimum: 1, maximum: 2 });
      quotas.push({ role: "upgrader", body: buildBody(Math.min(safeTiers, 5)), minimum: 1, maximum: 3 });
      break;
    case 6:
    case 7:
    case 8:
      quotas.push({ role: "harvester", body: buildBody(Math.min(safeTiers, 6)), minimum: 2, maximum: 5 });
      quotas.push({ role: "hauler", body: buildBody(Math.min(safeTiers, 5)), minimum: 2, maximum: 5 });
      quotas.push({ role: "builder", body: buildBody(Math.min(safeTiers, 4)), minimum: 1, maximum: 2 });
      quotas.push({ role: "upgrader", body: buildBody(Math.min(safeTiers, 6)), minimum: 1, maximum: 4 });
      break;
  }
  return quotas;
}
function runSpawnManager(room) {
  const spawns = room.find(FIND_MY_SPAWNS).filter((s) => !s.spawning);
  if (spawns.length === 0) return;
  const quotas = getSpawnQuotas(room);
  const creepCounts = {};
  const creeps = room.find(FIND_MY_CREEPS);
  for (const c of creeps) {
    const role = c.memory.role ?? "unknown";
    creepCounts[role] = (creepCounts[role] || 0) + 1;
  }
  for (const quota of quotas) {
    const current = creepCounts[quota.role] || 0;
    if (current >= quota.maximum) continue;
    const cost = quota.body.reduce((sum, part) => sum + BODYPART_COST[part], 0);
    if (room.energyAvailable < cost) continue;
    const name = `${quota.role}_${Game.time}`;
    for (const spawn of spawns) {
      const result = spawn.spawnCreep(quota.body, name, {
        memory: { role: quota.role, harvesting: true, building: false, upgrading: false }
      });
      if (result === 0) {
        trackSpawnSpend(room.name, cost);
        console.log(`[spawn] ${name} (${quota.role}) \u2014 ${cost}e`);
        return;
      }
    }
  }
}

// packages/bot/src/main.ts
function loop() {
  if (!Memory.began) {
    Memory.began = true;
    console.log("[apocrypha] Initializing colony...");
  }
  for (const name in Memory.creeps) {
    if (!(name in Game.creeps)) {
      delete Memory.creeps[name];
    }
  }
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (room.controller?.my) {
      runSpawnManager(room);
    }
  }
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    const role = creep.memory.role;
    switch (role) {
      case "harvester":
        runHarvester(creep);
        break;
      case "builder":
        runBuilder(creep);
        break;
      case "upgrader":
        runUpgrader(creep);
        break;
      // Hauler role — TODO: implement when RCL 3+ is reached
      // case 'hauler': runHauler(creep); break;
      default:
        console.log(`[warn] Unknown role "${role}" for creep ${name}`);
        creep.say("?");
        runHarvester(creep);
    }
  }
  collectStats();
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  loop
});
