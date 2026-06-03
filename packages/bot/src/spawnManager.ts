/**
 * spawnManager.ts — Apocrypha Spawn Manager
 *
 * Uses bodyDesigner for per-role body comps based on RCL and energy.
 * Manages spawn queues with quota limits and spawn gates.
 *
 * RCL 1-2: Survivors only (max 4). Generalists that do everything.
 * RCL 3+: Specialized roles appear. Survivors drop to max 2, with smart
 *   spawn criteria — only spawn when energy economy is genuinely faltering,
 *   not when a miner simply ages out and is being replaced.
 *
 * Spawn gates:
 * - survivor (RCL 3+): only when energy economy is threatened (not just miner death)
 * - builder: only if overflow container ≥50% full AND construction sites exist, max 2
 * - upgrader: only if controller container is full, max 1
 * - miner: max 2 (one per source)
 * - hauler: max 3 at RCL 3+, only if source containers exist
 */

import { getBody } from './bodyDesigner';
import { trackSpawnSpend } from './telemetry';

interface SpawnQuota {
  role: string;
  minimum: number;
  maximum: number;
}

/**
 * Get spawn quotas for a room based on RCL.
 */
function getQuotas(rcl: number): SpawnQuota[] {
  // RCL 1-2: survivors + miner + hauler (gates handle spawn conditions)
  if (rcl <= 2) {
    return [
      { role: 'survivor', minimum: 2, maximum: 4 },
      { role: 'miner',    minimum: 0, maximum: 0 },
      { role: 'hauler',   minimum: 0, maximum: 0 },
    ];
  }

  // RCL 3-4: survivors first, then miner + hauler.
  // Miner and hauler max are source-based (computed dynamically in the spawn loop).
  if (rcl >= 3 && rcl <= 4) {
    return [
      { role: 'survivor', minimum: 3, maximum: 8 },
      { role: 'miner',    minimum: 0, maximum: 0 },
      { role: 'hauler',   minimum: 0, maximum: 0 },
    ];
  }

  // RCL 5+: specialized roles, survivors as backup.
  // Miner and hauler max are source-based.
  const quotas: SpawnQuota[] = [
    { role: 'survivor', minimum: 0, maximum: 8 },
    { role: 'miner',    minimum: 0, maximum: 0 },
    { role: 'hauler',   minimum: 0, maximum: 0 },
    { role: 'builder',  minimum: 0, maximum: 2 },
    { role: 'upgrader', minimum: 0, maximum: 2 },
  ];

  return quotas;
}

/** Check if required containers are built (source containers + spawn overflow) */
function containersBuilt(room: Room): boolean {
  const sources = room.find(FIND_SOURCES);
  const spawns = room.find(FIND_MY_SPAWNS);
  if (spawns.length === 0) return false;

  // Check each source has an adjacent container
  for (const source of sources) {
    const nearby = source.pos.findInRange(FIND_STRUCTURES, 1, {
      filter: s => s.structureType === STRUCTURE_CONTAINER
    });
    if (nearby.length === 0) return false;
  }

  return true;
}

// ── Economy Tracker (container energy moving average) ──

interface EconomyMemory {
  /** Rolling window of max(source container energy) samples (max 40) */
  samples: number[];
  /** Soft cap for survivors, mapped from moving average */
  softCap: number;
  /** Next tick to collect a sample */
  nextSample: number;
}

const ECO_SAMPLE_INTERVAL = 5;
const ECO_WINDOW_SIZE = 40;

/** Map the moving average of max container energy to a survivor soft cap */
function econValToSoftCap(val: number): number {
  if (val >= 1500) return 8;
  if (val >= 1000) return 6;
  if (val >= 500) return 5;
  return 3;
}

function runEconomyTracker(room: Room): void {
  // Only active when miners exist and no storage is built — the window
  // between first miner spawn and storage construction.
  if (room.storage) return;
  const miners = room.find(FIND_MY_CREEPS).filter(c => c.memory.role === 'miner');
  if (miners.length === 0) return;

  if (!Memory.economy) {
    Memory.economy = { samples: [], softCap: 8, nextSample: Game.time };
  }
  const econ = Memory.economy as EconomyMemory;

  // Sample max container energy every ECO_SAMPLE_INTERVAL ticks
  if (Game.time >= econ.nextSample) {
    econ.nextSample = Game.time + ECO_SAMPLE_INTERVAL;

    let maxEnergy = 0;
    const sources = room.find(FIND_SOURCES);
    for (const source of sources) {
      const containers = source.pos.findInRange(FIND_STRUCTURES, 2, {
        filter: s => s.structureType === STRUCTURE_CONTAINER
      });
      for (const c of containers) {
        const e = c.store.getUsedCapacity(RESOURCE_ENERGY);
        if (e > maxEnergy) maxEnergy = e;
      }
    }

    econ.samples.push(maxEnergy);
    if (econ.samples.length > ECO_WINDOW_SIZE) econ.samples.shift();
  }

  // Window not full yet — keep default cap
  if (econ.samples.length < ECO_WINDOW_SIZE) return;

  // Compute unweighted average and map to soft cap
  const sum = econ.samples.reduce((a, b) => a + b, 0);
  const avg = sum / econ.samples.length;
  const newCap = econValToSoftCap(avg);

  if (newCap !== econ.softCap) {
    econ.softCap = newCap;
    console.log(`[economy] softCap=${econ.softCap} (avg=${avg.toFixed(0)} energy)`);
  }
}
function survivorGateRcl3(room: Room): boolean {
  // Soft cap from economy tracker — don't spawn beyond what the
  // container buffer can sustain
  const econ = Memory.economy as EconomyMemory | undefined;
  const survivorCount = room.find(FIND_MY_CREEPS).filter(c => c.memory.role === 'survivor').length;
  if (econ && survivorCount >= econ.softCap) return false;

  const miners = room.find(FIND_MY_CREEPS).filter(c => c.memory.role === 'miner');

  // If required containers aren't built yet, survivors stay active to build them
  if (!containersBuilt(room)) return true;

  // If 0 miners at all, definitely spawn survivor
  if (miners.length === 0) return true;

  // If we have at least 1 miner, check if the energy economy is actually struggling
  // Don't spawn survivors just because a miner aged out — wait for the replacement

  // Check if spawn is about to produce a miner (it's spawning or has energy)
  const spawns = room.find(FIND_MY_SPAWNS);
  const spawningMiner = spawns.some(s => {
    if (!s.spawning) return false;
    const spawningCreep = Game.creeps[s.spawning.name];
    return spawningCreep && spawningCreep.memory.role === 'miner';
  });

  // If a miner is currently spawning, defer to it
  if (spawningMiner) return false;

  // Soft cap from economy tracker is the sole limiter — spawn to fill
  return true;
}

/**
 * RCL 5+ survivor gate: spawn limits based on storage energy instead of
 * the economy soft-cap.  Survivors are the generalist workforce at all
 * RCLs now — storage level determines how many we can sustain.
 *
 *   storage < 100k   → max 3
 *   storage 100-200k  → max 5
 *   storage > 200k    → max 8
 */
function survivorGateRcl5(room: Room): boolean {
  const survivorCount = room.find(FIND_MY_CREEPS).filter(c => c.memory.role === 'survivor').length;

  // Storage-based cap
  const storageEnergy = room.storage?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
  let maxSurvivors = 1;
  if (storageEnergy >= 200_000) maxSurvivors = 8;
  else if (storageEnergy >= 100_000) maxSurvivors = 5;
  else if (storageEnergy >= 50_000) maxSurvivors = 3;

  if (survivorCount >= maxSurvivors) return false;

  // Safety checks (same as RCL 3-4)
  if (!containersBuilt(room)) return true;
  const miners = room.find(FIND_MY_CREEPS).filter(c => c.memory.role === 'miner');
  if (miners.length === 0) return true;

  return true;
}

/** Build gate: overflow container must be ≥50% full */
function builderGate(room: Room): boolean {
  const sites = room.find(FIND_CONSTRUCTION_SITES);
  if (sites.length === 0) return false;

  const spawns = room.find(FIND_MY_SPAWNS);
  if (spawns.length === 0) return false;

  const container = spawns[0].pos.findInRange(FIND_STRUCTURES, 3, {
    filter: s => s.structureType === STRUCTURE_CONTAINER
  })[0];
  if (!container) {
    // Allow builders at RCL 1-2 even without overflow container
    return (room.controller?.level ?? 0) <= 2;
  }

  const store = (container as StructureContainer).store;
  return store.getUsedCapacity(RESOURCE_ENERGY) >= store.getCapacity(RESOURCE_ENERGY) * 0.5;
}

/** Upgrader gate: controller container must exist and be full */
function upgraderGate(room: Room): boolean {
  const controller = room.controller;
  if (!controller) return false;
  const container = controller.pos.findInRange(FIND_STRUCTURES, 1, {
    filter: s => s.structureType === STRUCTURE_CONTAINER
  })[0];
  if (!container) return false;
  return (container as StructureContainer).store.getFreeCapacity(RESOURCE_ENERGY) === 0;
}

/** Miner gate: only spawn if a source with a container has no miner assigned yet */
function minerGate(room: Room): boolean {
  const sources = room.find(FIND_SOURCES);

  // Sources that have a container built next to them
  const eligibleSources = sources.filter(s =>
    s.pos.findInRange(FIND_STRUCTURES, 1, {
      filter: st => st.structureType === STRUCTURE_CONTAINER
    }).length > 0
  );

  if (eligibleSources.length === 0) return false;

  // Count miners already assigned to eligible sources
  const miners = room.find(FIND_MY_CREEPS).filter(c => c.memory.role === 'miner');
  let assignedCount = 0;
  for (const m of miners) {
    const sid = (m.memory as any).sourceId as string | undefined;
    if (sid && eligibleSources.some(s => s.id === sid)) assignedCount++;
  }

  return assignedCount < eligibleSources.length;
}

/** Dispatch to the correct gate function */
function spawnGate(role: string, room: Room): boolean {
  // If required containers aren't built, only survivors may spawn.
  // Miners get their own per-source container gate; others wait.
  if (role !== 'survivor' && !containersBuilt(room)) return false;

  switch (role) {
    case 'survivor': {
      const rcl = room.controller?.level ?? 0;
      return rcl >= 5 ? survivorGateRcl5(room) : survivorGateRcl3(room);
    }
    case 'miner':   return minerGate(room);
    case 'builder':  return builderGate(room);
    case 'upgrader': return upgraderGate(room);
    case 'hauler': {
      return room.storage !== undefined;
    }
    default: return true;
  }
}

// ── Colonization scout spawning ──

const SCOUT_MAX_RESPAWNS = 5;

function trySpawnScout(room: Room, spawn: StructureSpawn): boolean {
  const col = Memory.colonization as any;
  if (!col?.active || Game.time >= col.deadline) return false;
  if ((room.controller?.level ?? 0) < 5) return false;

  const targets: string[] = col.scoutTargets || [];
  if (targets.length === 0) return false;

  for (const targetRoom of targets) {
    const state = col.scoutState[targetRoom];
    if (!state) continue;

    // Room already scored — don't respawn
    if (state.done) continue;

    // Already alive?
    if (state.name && Game.creeps[state.name]) continue;

    // Respawning: must be within budget
    const respawns = state.respawns ?? 0;
    if (respawns >= SCOUT_MAX_RESPAWNS) continue;

    const scoutName = `scout_${targetRoom}_${Game.time}`;
    const result = spawn.spawnCreep([MOVE], scoutName, {
      memory: {
        role: 'scout',
        targetRoom,
        sourceRoom: room.name,
        respawns: respawns + 1,
        spawnTick: Game.time,
      }
    });

    if (result === OK) {
      col.scoutState[targetRoom] = {
        targetRoom,
        respawns: respawns + 1,
        name: scoutName,
        spawnedFrom: room.name,
      };
      return true;
    }
  }

  return false;
}

// ── Colonization claimer spawning ──

function trySpawnClaimer(room: Room, spawn: StructureSpawn): boolean {
  const col = Memory.colonization as any;
  if (col?.phase !== 'claiming') return false;

  const ct = col.claimTarget;
  if (!ct || room.name !== ct.sourceRoom) return false;

  // Already have a claimer alive?
  const claimers = room.find(FIND_MY_CREEPS).filter(c => c.memory.role === 'claimer');
  if (claimers.length > 0) return false;

  const name = `claimer_${Game.time}`;
  const result = spawn.spawnCreep([CLAIM, MOVE, MOVE], name, {
    memory: {
      role: 'claimer',
      targetRoom: ct.room,
      spawnX: ct.spawnX,
      spawnY: ct.spawnY,
      claimed: false,
      sitePlaced: false,
      spawnTick: Game.time,
    }
  });

  if (result === OK) {
    console.log(`[spawn] ${name} (claimer) → ${ct.room}`);
    return true;
  }

  return false;
}

// ── Colonization builder spawning ──

const COLONY_BUILDER_MAX = 3;

function trySpawnColonyBuilder(room: Room, spawn: StructureSpawn): boolean {
  const col = Memory.colonization as any;
  if (col?.phase !== 'building') return false;

  const ct = col.claimTarget;
  if (!ct || room.name !== ct.sourceRoom) return false;

  const builders = room.find(FIND_MY_CREEPS).filter(c => c.memory.role === 'colonyBuilder');
  if (builders.length >= COLONY_BUILDER_MAX) return false;

  const rcl = room.controller?.level ?? 0;
  const body = getBody('survivor', rcl, room.energyAvailable, room.energyCapacityAvailable);
  if (!body || body.length === 0) return false;

  const name = `colBuilder_${Game.time}`;
  const result = spawn.spawnCreep(body, name, {
    memory: {
      role: 'colonyBuilder',
      targetRoom: ct.room,
      harvesting: true,
      building: false,
      upgrading: false,
      task: 0, // TASK.HARVEST
      taskLockedUntil: 0,
      spawnTick: Game.time,
    }
  });

  if (result === OK) {
    const cost = body.reduce((sum, p) => sum + BODYPART_COST[p], 0);
    trackSpawnSpend(room.name, cost);
    console.log(`[spawn] ${name} (colonyBuilder) → ${ct.room} cost=${cost}e`);
    return true;
  }

  return false;
}

// ── Spawn Manager ──

/** Run spawn logic for one room. Call once per tick. */
export function runSpawnManager(room: Room): void {
  // Update economy tracker (container energy moving average + soft cap)
  runEconomyTracker(room);

  const spawns = room.find(FIND_MY_SPAWNS).filter(s => !s.spawning);
  if (spawns.length === 0) return;

  const rcl = room.controller?.level ?? 0;
  const quotas = getQuotas(rcl);

  // Count current creeps by role
  const creepCounts: Record<string, number> = {};
  for (const c of room.find(FIND_MY_CREEPS)) {
    const role = c.memory.role ?? 'unknown';
    creepCounts[role] = (creepCounts[role] || 0) + 1;
  }

  // ── Regular roles (priority: survivor → miner → hauler → builder → upgrader) ──
  // Count source containers for hauler quota (1 per container)
  const sourceContainers = room.find(FIND_SOURCES).reduce((count, source) => {
    return count + source.pos.findInRange(FIND_STRUCTURES, 1, {
      filter: s => s.structureType === STRUCTURE_CONTAINER
    }).length;
  }, 0);

  const sourceCount = room.find(FIND_SOURCES).length;
  for (const quota of quotas) {
    const current = creepCounts[quota.role] || 0;

    // Miner max is one per source. Hauler max is one per source container.
    const effectiveMax = quota.role === 'miner' ? sourceCount
      : quota.role === 'hauler' ? sourceContainers
      : quota.maximum;

    // Skip if at max
    if (current >= effectiveMax) continue;

    // Gate applies when at or above minimum (regardless of RCL)
    if (current >= quota.minimum) {
      if (!spawnGate(quota.role, room)) continue;
    }

    // ── Spawn cooldown: wait if full-capacity body is better than what's available now ──
    if (!Memory.spawnCooldowns) Memory.spawnCooldowns = {};
    const cooldown = Memory.spawnCooldowns;
    const role = quota.role;

    // Cooldown active → skip this role
    if (cooldown[role] && Game.time < cooldown[role]) continue;

    // Get body with current energy
    const body = getBody(role, rcl, room.energyAvailable, room.energyCapacityAvailable);

    // Cooldown just expired → force-spawn with whatever we have
    if (cooldown[role] && Game.time >= cooldown[role]) {
      delete cooldown[role];
      if (!body || body.length === 0) continue; // still nothing affordable — skip
    } else {
      // No cooldown active — check if we should wait for a better body
      const bestBody = getBody(role, rcl, room.energyCapacityAvailable, room.energyCapacityAvailable);
      if (bestBody && body) {
        const bestCost = bestBody.reduce((sum, p) => sum + BODYPART_COST[p], 0);
        const curCost = body.reduce((sum, p) => sum + BODYPART_COST[p], 0);
        if (bestCost > curCost && room.energyAvailable < room.energyCapacityAvailable) {
          cooldown[role] = Game.time + 50;
          continue;
        }
      }
    }

    if (!body || body.length === 0) continue;

    const name = quota.role + '_' + Game.time;
    for (const spawn of spawns) {
      const result = spawn.spawnCreep(body, name, {
        memory: {
          role: quota.role,
          harvesting: true,
          building: false,
          upgrading: false,
          positioned: false,
          task: 2, // Task.HARVEST for survivors
          taskLockedUntil: 0,
        }
      });
      if (result === OK) {
        const cost = body.reduce((sum, p) => sum + BODYPART_COST[p], 0);
        trackSpawnSpend(room.name, cost);
        console.log('[spawn] ' + name + ' (' + quota.role + ') body=' + body.join(',') + ' cost=' + cost + 'e');
        return;
      }
    }
  }

  // ── Colonization scouts (after regular roles, before claimer) ──
  if (trySpawnScout(room, spawns[0])) return;

  // ── Colonization claimer ──
  if (trySpawnClaimer(room, spawns[0])) return;

  // ── Colonization builders (lowest priority) ──
  if (trySpawnColonyBuilder(room, spawns[0])) return;
}
