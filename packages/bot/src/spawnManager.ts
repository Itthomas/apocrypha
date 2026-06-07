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
 * - miner: one per source with a container
 * - hauler: economy-based quota when storage exists
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

  // RCL 5+: survivors + miner + hauler.
  // Miner and hauler max are source-based.
  const quotas: SpawnQuota[] = [
    { role: 'survivor', minimum: 0, maximum: 8 },
    { role: 'miner',    minimum: 0, maximum: 0 },
    { role: 'hauler',   minimum: 0, maximum: 0 },
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
  /** Latest unweighted average of the sample window */
  avgVal: number;
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

/** Map the moving average of max container energy to a hauler quota */
function econValToHaulerCap(val: number): number {
  if (val >= 1500) return 4;
  if (val >= 1000) return 3;
  if (val >= 500) return 2;
  return 1;
}

function runEconomyTracker(room: Room): void {
  // Keep sampling across all phases; survivor soft cap only adjusted pre-storage.
  if (!Memory.rooms) (Memory as any).rooms = {};
  if (!Memory.rooms[room.name]) Memory.rooms[room.name] = {} as any;
  if (!(Memory.rooms[room.name] as any).economy) {
    (Memory.rooms[room.name] as any).economy = { samples: [], softCap: 8, avgVal: 0, nextSample: Game.time };
  }
  const econ = (Memory.rooms[room.name] as any).economy as EconomyMemory;

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

  // Compute unweighted average and store for hauler quotas
  const sum = econ.samples.reduce((a, b) => a + b, 0);
  const avg = sum / econ.samples.length;
  econ.avgVal = avg;

  // Survivor soft cap: only adjusted when no storage exists
  if (!room.storage) {
    const newCap = econValToSoftCap(avg);
    if (newCap !== econ.softCap) {
      econ.softCap = newCap;
      console.log(`[economy] softCap=${econ.softCap} (avg=${avg.toFixed(0)} energy)`);
    }
  }
}
/** Survivor at RCL ≤ 2: bump max to 8 when miners are active */
function getHaulerMax(room: Room): number {
  // Post-storage: use economy tracker average
  if (room.storage) {
    const econ = (Memory.rooms[room.name] as any)?.economy as EconomyMemory | undefined;
    if (econ && econ.samples.length >= ECO_WINDOW_SIZE) {
      return econValToHaulerCap(econ.avgVal);
    }
    return 1; // window not full yet — conservative
  }
  // Pre-storage: count source containers
  return room.find(FIND_SOURCES).reduce((count, source) => {
    return count + source.pos.findInRange(FIND_STRUCTURES, 1, {
      filter: s => s.structureType === STRUCTURE_CONTAINER
    }).length;
  }, 0);
}

function survivorGateRcl3(room: Room): boolean {
  // Soft cap from economy tracker — don't spawn beyond what the
  // container buffer can sustain
  const econ = (Memory.rooms[room.name] as any).economy as EconomyMemory | undefined;
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
      return room.storage ? survivorGateRcl5(room) : survivorGateRcl3(room);
    }
    case 'miner':   return minerGate(room);
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

  const targets: string[] = (col.scoutTargets && col.scoutTargets[room.name]) || [];
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
  const result = spawn.spawnCreep([CLAIM, MOVE, MOVE, MOVE, MOVE, MOVE], name, {
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

// ── Combat spawning (per-room attack targets) ──

/** Strip surrounding quotes from a room name (console input artifact) */
function sanitizeRoomName(name: string): string {
  if (name.startsWith('"') && name.endsWith('"')) return name.slice(1, -1);
  if (name.startsWith("'") && name.endsWith("'")) return name.slice(1, -1);
  return name;
}

function trySpawnCombat(room: Room, spawn: StructureSpawn): boolean {
  if ((room.controller?.level ?? 0) < 3) return false;

  const targets = (Memory.rooms[room.name] as any)?.attackTargets;
  if (!targets) return false;

  const rcl = room.controller?.level ?? 0;

  // Attacker
  const attackerTargets = normalizeTargets(targets.attacker);
  for (const [targetRoom, quota] of attackerTargets) {
    if (countCombatCreeps('attacker', targetRoom) >= quota) continue;
    const body = getBody('attacker', rcl, room.energyAvailable, room.energyCapacityAvailable);
    if (!body || body.length === 0) continue;
    const name = `attacker_${targetRoom}_${Game.time}`;
    const result = spawn.spawnCreep(body, name, {
      memory: { role: 'attacker', targetRoom, spawnTick: Game.time }
    });
    if (result === OK) {
      console.log(`[spawn] ${name} (attacker) → ${targetRoom}`);
      return true;
    }
  }

  // Attrition
  const attritionTargets = normalizeTargets(targets.attrition);
  for (const [targetRoom, quota] of attritionTargets) {
    if (countCombatCreeps('attrition', targetRoom) >= quota) continue;
    const body = getBody('attrition', rcl, room.energyAvailable, room.energyCapacityAvailable);
    if (!body || body.length === 0) continue;
    const name = `attrition_${targetRoom}_${Game.time}`;
    const result = spawn.spawnCreep(body, name, {
      memory: {
        role: 'attrition',
        targetRoom,
        phase: 'attriting',
        sourceRoom: room.name,
        spawnTick: Game.time,
      }
    });
    if (result === OK) {
      console.log(`[spawn] ${name} (attrition) → ${targetRoom}`);
      return true;
    }
  }

  return false;
}

/** Normalize attack targets: array → {room: 1}, object kept as-is */
function normalizeTargets(targets: any): Array<[string, number]> {
  if (!targets) return [];
  if (Array.isArray(targets)) {
    return targets.map((r: string) => [sanitizeRoomName(r), 1] as [string, number]);
  }
  return Object.entries(targets).map(([r, q]) => [sanitizeRoomName(r), q as number] as [string, number]);
}

/** Count how many combat creeps with the given role and target are alive */
function countCombatCreeps(role: string, targetRoom: string): number {
  let count = 0;
  for (const name in Game.creeps) {
    const c = Game.creeps[name];
    if (c.memory.role === role && (c.memory as any).targetRoom === targetRoom) count++;
  }
  return count;
}

// ── Colonization builder spawning ──

const COLONY_BUILDER_MAX = 3;

// ── Remote harvesting spawning ──

function trySpawnRemote(room: Room, spawn: StructureSpawn): boolean {
  if ((room.controller?.level ?? 0) < 5) return false;

  const rooms = (Memory.rooms[room.name] as any)?.remoteRooms;
  if (!rooms) return false;
  const rcl = room.controller?.level ?? 0;

  for (const remoteName of Object.keys(rooms)) {
    const entry = rooms[remoteName];
    if (!entry) continue;

    // Remote scout
    if (entry.phase === 'scouting') {
      if (isRemoteCreepAlive('remoteScout', room.name, remoteName)) continue;
      const name = `remoteScout_${remoteName}_${Game.time}`;
      const result = spawn.spawnCreep([MOVE], name, {
        memory: { role: 'remoteScout', targetRoom: remoteName, sourceRoom: room.name, spawnTick: Game.time }
      });
      if (result === OK) { console.log(`[spawn] ${name} (remoteScout) → ${remoteName}`); return true; }
    }

    // Attacker for defend phase — one per remote room
    if (entry.phase === 'defend') {
      if (countCreepsByTarget('defender', remoteName, room.name) < 2) {
        const body = getBody('defender', rcl, room.energyAvailable, room.energyCapacityAvailable);
        if (body && body.length > 0) {
          const name = `defender_${remoteName}_${Game.time}`;
          const result = spawn.spawnCreep(body, name, {
            memory: { role: 'defender', targetRoom: remoteName, spawnTick: Game.time }
          });
          if (result === OK) { console.log(`[spawn] ${name} (defender) → ${remoteName} (defend)`); return true; }
        }
      }
    }

    // Reserver and remote workers — only during harvesting
    if (entry.phase === 'harvesting') {
      const needed = (entry.reserveTicks ?? 0) < 4000;
      if (needed && !isRemoteCreepAlive('reserver', room.name, remoteName)) {
        const name = `reserver_${remoteName}_${Game.time}`;
        const result = spawn.spawnCreep([CLAIM, CLAIM, MOVE, MOVE], name, {
          memory: { role: 'reserver', targetRoom: remoteName, sourceRoom: room.name, spawnTick: Game.time }
        });
        if (result === OK) { console.log(`[spawn] ${name} (reserver) → ${remoteName}`); return true; }
      }

      // Remote worker — 2 per source, each assigned to a specific source
      const workerCount = countCreepsByTarget('remoteWorker', remoteName, room.name);
      const sourceCount = entry.sources?.length || 0;
      const maxWorkers = sourceCount * 2;
      if (maxWorkers > 0 && workerCount < maxWorkers) {
        const body = getBody('remoteWorker', rcl, room.energyAvailable, room.energyCapacityAvailable);
        if (!body || body.length === 0) {
          logSpawnDebug(room.name, remoteName, 'noBody', { energy: room.energyAvailable, rcl });
        } else {
          // Assign to least-contended source
          const srcCounts = new Array<number>(sourceCount).fill(0);
          for (const n in Game.creeps) {
            const c = Game.creeps[n];
            if (c.memory.role === 'remoteWorker' && (c.memory as any).targetRoom === remoteName && (c.memory as any).sourceRoom === room.name) {
              const idx = (c.memory as any).sourceIdx as number;
              if (idx !== undefined && idx < sourceCount) srcCounts[idx]++;
            }
          }
          let bestIdx = 0;
          for (let i = 1; i < sourceCount; i++) {
            if (srcCounts[i] < srcCounts[bestIdx]) bestIdx = i;
          }
          const src = entry.sources[bestIdx];
          const name = `remoteWorker_${remoteName}_${bestIdx}_${Game.time}`;
          const result = spawn.spawnCreep(body, name, {
            memory: {
              role: 'remoteWorker', targetRoom: remoteName, sourceRoom: room.name,
              spawnTick: Game.time, task: 0, sourceIdx: bestIdx,
              sourcePos: { x: src.x, y: src.y },
            }
          });
          if (result === OK) { console.log(`[spawn] ${name} (remoteWorker) → ${remoteName} src=${bestIdx}`); return true; }
          else { logSpawnDebug(room.name, remoteName, 'spawnFail', { result, bodyCost: body.reduce((s: number, p: string) => s + BODYPART_COST[p as BodyPartConstant], 0), energy: room.energyAvailable }); }
        }
      } else {
        logSpawnDebug(room.name, remoteName, 'quota', { workerCount, maxWorkers });
      }
    }
  }

  return false;
}

function isRemoteCreepAlive(role: string, sourceRoom: string, targetRoom: string): boolean {
  for (const name in Game.creeps) {
    const c = Game.creeps[name];
    if (c.memory.role === role &&
        (c.memory as any).targetRoom === targetRoom &&
        (c.memory as any).sourceRoom === sourceRoom) return true;
  }
  return false;
}

function countCreepsByTarget(role: string, targetRoom: string, sourceRoom: string): number {
  let count = 0;
  for (const name in Game.creeps) {
    const c = Game.creeps[name];
    if (c.memory.role === role &&
        (c.memory as any).targetRoom === targetRoom &&
        (c.memory as any).sourceRoom === sourceRoom) count++;
  }
  return count;
}

function logSpawnDebug(sourceRoom: string, remoteRoom: string, reason: string, data: any): void {
  if (!Memory._spawnDebug) (Memory as any)._spawnDebug = {};
  (Memory as any)._spawnDebug[`${sourceRoom}→${remoteRoom}`] = { tick: Game.time, reason, ...data };
}

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

  // ── Regular roles (priority: survivor → miner → hauler) ──
  const sourceCount = room.find(FIND_SOURCES).length;
  for (const quota of quotas) {
    const current = creepCounts[quota.role] || 0;

    // Miner max is one per source. Hauler max: economy-based when storage exists.
    let effectiveMax = quota.role === 'miner' ? sourceCount
      : quota.role === 'hauler' ? getHaulerMax(room)
      : quota.maximum;

    // Survivor at RCL ≤ 2: bump max to 8 when miners are active
    if (quota.role === 'survivor' && rcl <= 2) {
      const hasMiners = (creepCounts['miner'] || 0) > 0;
      if (hasMiners) effectiveMax = 8;
    }

    // Skip if at max
    if (current >= effectiveMax) continue;

    // Gate applies when at or above minimum (regardless of RCL)
    if (current >= quota.minimum) {
      if (!spawnGate(quota.role, room)) continue;
    }

    // ── Spawn cooldown (per-room, per-role): wait if full-capacity body is ──
    // better than what's available now.
    if (!Memory.rooms) (Memory as any).rooms = {};
    if (!Memory.rooms[room.name]) Memory.rooms[room.name] = {} as any;
    if (!Memory.rooms[room.name].spawnCooldowns) Memory.rooms[room.name].spawnCooldowns = {};
    const cooldown = Memory.rooms[room.name].spawnCooldowns;
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

  // ── Remote harvesting (before combat) ──
  if (trySpawnRemote(room, spawns[0])) return;

  // ── Combat: attack targets from room memory ──
  if (trySpawnCombat(room, spawns[0])) return;

  // ── Colonization builders (lowest priority) ──
  if (trySpawnColonyBuilder(room, spawns[0])) return;
}
