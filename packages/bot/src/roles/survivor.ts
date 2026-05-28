/**
 * roles/survivor.ts — Apocrypha Survivor (Generalist)
 *
 * Simple state machine, no task locks:
 *   Carry empty → harvest from nearest available source
 *   Carry full  → deliver to spawn/extensions
 *   If nowhere to deliver → build nearest construction site
 *   If nothing to build → upgrade controller
 *
 * Source slot claiming prevents thrashing.
 */

import { trackHarvest } from '../telemetry';

interface SurvivorMemory {
  role: 'survivor';
}

// ── Source slot claiming ──

interface SourceClaims {
  [sourceId: string]: Record<string, string>; // "x,y" → creepName
}

function getClaims(): SourceClaims {
  if (!Memory.sourceClaims) Memory.sourceClaims = {};
  return Memory.sourceClaims as SourceClaims;
}

function cleanClaims(): void {
  const claims = getClaims();
  for (const sourceId in claims) {
    for (const slot in claims[sourceId]) {
      const name = claims[sourceId][slot];
      if (!(name in Game.creeps)) delete claims[sourceId][slot];
    }
    if (Object.keys(claims[sourceId]).length === 0) delete claims[sourceId];
  }
}

function claimSlot(creep: Creep, source: Source): {x: number, y: number} | null {
  cleanClaims();
  const claims = getClaims();
  const srcClaims = claims[source.id] || {};

  // Remove our own old claim at this source
  for (const slot in srcClaims) {
    if (srcClaims[slot] === creep.name) delete srcClaims[slot];
  }

  const room = Game.rooms[source.pos.roomName];
  if (!room) return null;

  // Find an unclaimed adjacent non-wall tile
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      if (room.getTerrain().get(source.pos.x + dx, source.pos.y + dy) === TERRAIN_MASK_WALL) continue;
      const key = (source.pos.x + dx) + ',' + (source.pos.y + dy);
      if (!srcClaims[key]) {
        if (!claims[source.id]) claims[source.id] = {};
        claims[source.id][key] = creep.name;
        return {x: source.pos.x + dx, y: source.pos.y + dy};
      }
    }
  }
  return null;
}

function releaseClaim(creep: Creep): void {
  const claims = getClaims();
  for (const sourceId in claims) {
    for (const slot in claims[sourceId]) {
      if (claims[sourceId][slot] === creep.name) delete claims[sourceId][slot];
    }
    if (Object.keys(claims[sourceId]).length === 0) delete claims[sourceId];
  }
}

// ── Main loop ──

export function run(creep: Creep): boolean {
  // STATE: carry is full → must deliver/use energy
  if (creep.store.getFreeCapacity() === 0) {
    releaseClaim(creep);
    return doDeliverOrUse(creep);
  }

  // STATE: carry has space → harvest (or deliver if spawn is critically empty)
  if (creep.store.getUsedCapacity(RESOURCE_ENERGY) >= 50) {
    const spawns = creep.room.find(FIND_MY_SPAWNS);
    if (spawns.some(s => s.store.getUsedCapacity(RESOURCE_ENERGY) < 100)) {
      releaseClaim(creep);
      return doDeliverOrUse(creep);
    }
  }

  return doHarvest(creep);
}

// ── Harvest ──

function doHarvest(creep: Creep): boolean {
  // Pick source with available slots, nearest first
  const sources = creep.room.find(FIND_SOURCES_ACTIVE)
    .filter(s => s.energy > 0)
    .sort((a, b) => creep.pos.getRangeTo(a) - creep.pos.getRangeTo(b));

  for (const source of sources) {
    const slot = claimSlot(creep, source);
    if (slot) {
      const result = creep.harvest(source);
      if (result === ERR_NOT_IN_RANGE) creep.moveTo(source);
      else if (result === OK) trackHarvest(creep.room.name, creep.getActiveBodyparts(WORK) * 2);
      return true;
    }
  }

  // All sources full — upgrade controller while waiting
  if (creep.room.controller) {
    if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
      creep.moveTo(creep.room.controller);
    }
  }
  return true;
}

// ── Deliver or use energy ──

function doDeliverOrUse(creep: Creep): boolean {
  // 1. Fill spawn (highest priority)
  const spawn = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_SPAWN && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
  });
  if (spawn) {
    if (creep.transfer(spawn, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) creep.moveTo(spawn);
    return true;
  }

  // 2. Fill extensions
  const ext = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_EXTENSION && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
  });
  if (ext) {
    if (creep.transfer(ext, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) creep.moveTo(ext);
    return true;
  }

  // 3. Build nearest construction site
  const site = creep.pos.findClosestByPath(FIND_CONSTRUCTION_SITES);
  if (site) {
    const result = creep.build(site);
    if (result === ERR_NOT_IN_RANGE) creep.moveTo(site);
    else if (result === ERR_NOT_ENOUGH_ENERGY) return doHarvest(creep); // ran out, go harvest
    return true;
  }

  // 4. Upgrade controller (nothing else to do)
  if (creep.room.controller) {
    if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
      creep.moveTo(creep.room.controller);
    }
    return true;
  }

  return false;
}
