/**
 * constructionPlanner.ts — Blueprint-driven construction planner
 *
 * Each RCL has a list of batches. A batch is either:
 *   static  — positions from the spawn-relative blueprint
 *   dynamic — generated at runtime (roads to sources, containers,
 *             remaining extensions, links, etc.)
 *
 * Only one batch is active at a time. The planner advances to the
 * next batch when all construction sites from the current one are built.
 */

import { BLUEPRINT, BlueprintEntry, getBlueprintPositions } from './blueprint';

// ── Types ──

interface PlannerMemory {
  rcl: number;
  batch: number;
  batchPlaced: boolean;
}

type BatchDef = StaticBatchDef | DynamicBatchDef;

interface StaticBatchDef {
  label: string;
  kind: 'static';
  /** Entries from the blueprint for this batch */
  entries: BlueprintEntry[];
}

interface DynamicBatchDef {
  label: string;
  kind: 'dynamic';
  /** Generator: returns number of sites placed this tick */
  place: (room: Room, spawn: StructureSpawn) => number;
}

// ── Helpers ──

function placeIfNew(room: Room, x: number, y: number, type: BuildableStructureConstant): boolean {
  if (x < 0 || x > 49 || y < 0 || y > 49) return false;
  if (room.getTerrain().get(x, y) === TERRAIN_MASK_WALL) return false;
  const existing = room.lookForAt(LOOK_CONSTRUCTION_SITES, x, y);
  if (existing.length > 0) return false;
  const structures = room.lookForAt(LOOK_STRUCTURES, x, y);
  if (structures.length > 0 && structures[0].structureType === type) return false;
  return room.createConstructionSite(x, y, type) === OK;
}

function countBuilt(room: Room, type: BuildableStructureConstant): number {
  return room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === type }).length;
}

function countSites(room: Room, type?: BuildableStructureConstant): number {
  if (type) return room.find(FIND_CONSTRUCTION_SITES, { filter: s => s.structureType === type }).length;
  return room.find(FIND_CONSTRUCTION_SITES).length;
}

// ── Dynamic Placeholders ──
// These are stubs that will be filled in with real placement logic.
// For now they return 0 (skip) so the planner can advance past them.

/** Cached set of all blueprint-claimed offsets from spawn */
let _bpPositions: Set<string> | null = null;
function bpPositions(): Set<string> {
  if (!_bpPositions) _bpPositions = getBlueprintPositions();
  return _bpPositions;
}

/** True if (absX, absY) falls inside the blueprint footprint */
function isBlueprintInterior(absX: number, absY: number, spawn: StructureSpawn): boolean {
  return bpPositions().has(`${absX - spawn.pos.x},${absY - spawn.pos.y}`);
}

function placeRoadsToSources(room: Room, spawn: StructureSpawn): number {
  const sources = room.find(FIND_SOURCES);
  let placed = 0;
  for (const source of sources) {
    const path = room.findPath(spawn.pos, source.pos, { ignoreCreeps: true, swampCost: 1 });
    for (const step of path) {
      // Don't pave over blueprint interior — the static road grid handles those tiles
      if (isBlueprintInterior(step.x, step.y, spawn)) continue;
      if (placeIfNew(room, step.x, step.y, STRUCTURE_ROAD)) placed++;
    }
  }
  return placed;
}

function placeRoadToController(room: Room, spawn: StructureSpawn): number {
  if (!room.controller) return 0;
  let placed = 0;
  const path = room.findPath(spawn.pos, room.controller.pos, { ignoreCreeps: true, swampCost: 1 });
  for (const step of path) {
    if (isBlueprintInterior(step.x, step.y, spawn)) continue;
    if (placeIfNew(room, step.x, step.y, STRUCTURE_ROAD)) placed++;
  }
  return placed;
}

function placeRoadsToSourcesAndController(room: Room, spawn: StructureSpawn): number {
  return placeRoadsToSources(room, spawn) + placeRoadToController(room, spawn);
}

function placeSourceContainers(room: Room, _spawn: StructureSpawn): number {
  const sources = room.find(FIND_SOURCES);
  let placed = 0;
  for (const source of sources) {
    const nearby = source.pos.findInRange(FIND_STRUCTURES, 1, {
      filter: s => s.structureType === STRUCTURE_CONTAINER
    });
    const nearbySites = source.pos.findInRange(FIND_CONSTRUCTION_SITES, 1, {
      filter: s => s.structureType === STRUCTURE_CONTAINER
    });
    if (nearby.length > 0 || nearbySites.length > 0) continue;

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const x = source.pos.x + dx;
        const y = source.pos.y + dy;
        if (room.getTerrain().get(x, y) !== TERRAIN_MASK_WALL) {
          if (placeIfNew(room, x, y, STRUCTURE_CONTAINER)) { placed++; break; }
        }
      }
      if (placed > 0) break;
    }
  }
  return placed;
}

function placeControllerContainer(room: Room, _spawn: StructureSpawn): number {
  const controller = room.controller;
  if (!controller) return 0;
  const existing = controller.pos.findInRange(FIND_STRUCTURES, 1, {
    filter: s => s.structureType === STRUCTURE_CONTAINER
  });
  if (existing.length > 0) return 0;

  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      const x = controller.pos.x + dx;
      const y = controller.pos.y + dy;
      if (placeIfNew(room, x, y, STRUCTURE_CONTAINER)) return 1;
    }
  }
  return 0;
}

/** Place remaining extensions that don't fit in the blueprint skeleton */
function placeDynamicExtensions(room: Room, spawn: StructureSpawn): number {
  const maxExtensions = CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION][room.controller?.level ?? 0] || 0;
  const existing = countBuilt(room, STRUCTURE_EXTENSION) + countSites(room, STRUCTURE_EXTENSION);
  const toPlace = Math.max(0, maxExtensions - existing);
  if (toPlace === 0) return 0;

  let placed = 0;
  // Spiral outward from spawn, placing extensions in open spaces
  for (let r = 6; r <= 12 && placed < toPlace; r++) {
    for (let dx = -r; dx <= r && placed < toPlace; dx++) {
      for (let dy = -r; dy <= r && placed < toPlace; dy++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = spawn.pos.x + dx;
        const y = spawn.pos.y + dy;
        if (x < 1 || x > 48 || y < 1 || y > 48) continue;
        if (placeIfNew(room, x, y, STRUCTURE_EXTENSION)) placed++;
      }
    }
  }
  return placed;
}

/** Place links adjacent to sources (RCL 5+) */
function placeSourceLinks(room: Room, _spawn: StructureSpawn): number {
  if ((room.controller?.level ?? 0) < 5) return 0;
  const maxLinks = CONTROLLER_STRUCTURES[STRUCTURE_LINK][room.controller?.level ?? 0] || 0;
  const existing = countBuilt(room, STRUCTURE_LINK) + countSites(room, STRUCTURE_LINK);
  if (existing >= maxLinks) return 0;

  const sources = room.find(FIND_SOURCES);
  let placed = 0;
  for (const source of sources) {
    if (existing + placed >= maxLinks) break;
    const nearbyLink = source.pos.findInRange(FIND_STRUCTURES, 2, {
      filter: s => s.structureType === STRUCTURE_LINK
    });
    if (nearbyLink.length > 0) continue;
    for (let dx = -1; dx <= 1 && existing + placed < maxLinks; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const x = source.pos.x + dx;
        const y = source.pos.y + dy;
        if (placeIfNew(room, x, y, STRUCTURE_LINK)) { placed++; break; }
      }
    }
  }
  return placed;
}

/** Place controller link (RCL 5+) — stub for now */
function placeControllerLink(_room: Room, _spawn: StructureSpawn): number {
  // TODO: place link near controller to receive from source links
  return 0;
}

/** Place extractor on mineral + container nearby (RCL 6+) */
function placeExtractorAndMineralContainer(room: Room, _spawn: StructureSpawn): number {
  if ((room.controller?.level ?? 0) < 6) return 0;
  let placed = 0;
  const minerals = room.find(FIND_MINERALS);
  for (const mineral of minerals) {
    if (mineral.mineralAmount === 0) continue;
    // Extractor on the mineral
    const existingExt = mineral.pos.lookFor(LOOK_STRUCTURES).filter(s => s.structureType === STRUCTURE_EXTRACTOR);
    if (existingExt.length === 0) {
      if (placeIfNew(room, mineral.pos.x, mineral.pos.y, STRUCTURE_EXTRACTOR)) placed++;
    }
    // Container nearby
    const nearbyContainer = mineral.pos.findInRange(FIND_STRUCTURES, 1, {
      filter: s => s.structureType === STRUCTURE_CONTAINER
    });
    if (nearbyContainer.length === 0) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue;
          if (placeIfNew(room, mineral.pos.x + dx, mineral.pos.y + dy, STRUCTURE_CONTAINER)) { placed++; break; }
        }
      }
    }
  }
  return placed;
}

// ── Batch Definitions Per RCL ──
//
// Each RCL has an ordered list of batches. Static batches reference
// the blueprint by RCL+batch number. Dynamic batches have generator
// functions. Empty blueprint batches are skipped (replaced by
// dynamic equivalents where needed).

function getBatches(rcl: number): BatchDef[] {
  const bp = BLUEPRINT[rcl];
  const batches: BatchDef[] = [];

  // RCL 1: roads first — creeps need paths from the start
  if (rcl >= 1) {
    batches.push({ label: 'roads_src_ctrl', kind: 'dynamic', place: placeRoadsToSourcesAndController });
  }

  // RCL 2: extensions batch 1, road grid, source containers
  if (rcl >= 2 && bp) {
    if (bp[1]?.length) batches.push({ label: 'ext_1', kind: 'static', entries: bp[1] });
    if (bp[2]?.length) batches.push({ label: 'roads_grid', kind: 'static', entries: bp[2] });
    batches.push({ label: 'source_containers', kind: 'dynamic', place: placeSourceContainers });
  }

  // RCL 3: extensions batch 2, tower 1, controller container
  if (rcl >= 3 && bp) {
    if (bp[1]?.length) batches.push({ label: 'ext_2', kind: 'static', entries: bp[1] });
    batches.push({ label: 'ctrl_container', kind: 'dynamic', place: placeControllerContainer });
    if (bp[2]?.length) batches.push({ label: 'tower_1', kind: 'static', entries: bp[2] });
  }

  // RCL 4: extensions batch 3, storage
  if (rcl >= 4 && bp) {
    if (bp[1]?.length) batches.push({ label: 'ext_3', kind: 'static', entries: bp[1] });
    if (bp[2]?.length) batches.push({ label: 'storage', kind: 'static', entries: bp[2] });
  }

  // RCL 5: extensions batch 4, source links, tower 2, outer ramparts
  if (rcl >= 5 && bp) {
    if (bp[1]?.length) batches.push({ label: 'ext_4', kind: 'static', entries: bp[1] });
    batches.push({ label: 'source_links', kind: 'dynamic', place: placeSourceLinks });
    batches.push({ label: 'ctrl_link', kind: 'dynamic', place: placeControllerLink });
    if (bp[2]?.length) batches.push({ label: 'tower_2', kind: 'static', entries: bp[2] });
    if (bp[3]?.length) batches.push({ label: 'outer_ramparts', kind: 'static', entries: bp[3] });
  }

  // RCL 6: extensions batch 5, extractor/mineral container, link, terminal, labs 1
  if (rcl >= 6 && bp) {
    if (bp[1]?.length) batches.push({ label: 'ext_5', kind: 'static', entries: bp[1] });
    batches.push({ label: 'extractor_mineral', kind: 'dynamic', place: placeExtractorAndMineralContainer });
    if (bp[2]?.length) batches.push({ label: 'link_core', kind: 'static', entries: bp[2] });
    if (bp[3]?.length) batches.push({ label: 'terminal', kind: 'static', entries: bp[3] });
    if (bp[4]?.length) batches.push({ label: 'labs_1', kind: 'static', entries: bp[4] });
  }

  // RCL 7: extensions batch 6, dynamic ext, tower 3, spawn 2, labs 2, factory, inner ramparts
  if (rcl >= 7 && bp) {
    if (bp[1]?.length) batches.push({ label: 'ext_6', kind: 'static', entries: bp[1] });
    // Batch 2 is empty in blueprint — dynamic extension placement
    if (bp[2] !== undefined && bp[2].length === 0) {
      batches.push({ label: 'ext_dynamic_1', kind: 'dynamic', place: placeDynamicExtensions });
    }
    if (bp[3]?.length) batches.push({ label: 'tower_3', kind: 'static', entries: bp[3] });
    if (bp[4]?.length) batches.push({ label: 'spawn_2', kind: 'static', entries: bp[4] });
    if (bp[5]?.length) batches.push({ label: 'labs_2', kind: 'static', entries: bp[5] });
    if (bp[6]?.length) batches.push({ label: 'factory', kind: 'static', entries: bp[6] });
    if (bp[7]?.length) batches.push({ label: 'inner_ramparts', kind: 'static', entries: bp[7] });
  }

  // RCL 8: dynamic ext, towers 4-6, labs 3, spawn 3, core ramparts, nuker, power spawn
  if (rcl >= 8 && bp) {
    // Batch 1 is empty — dynamic extension placement
    if (bp[1] !== undefined && bp[1].length === 0) {
      batches.push({ label: 'ext_dynamic_2', kind: 'dynamic', place: placeDynamicExtensions });
    }
    if (bp[2]?.length) batches.push({ label: 'towers_4_5_6', kind: 'static', entries: bp[2] });
    if (bp[3]?.length) batches.push({ label: 'labs_3', kind: 'static', entries: bp[3] });
    if (bp[4]?.length) batches.push({ label: 'spawn_3', kind: 'static', entries: bp[4] });
    if (bp[5]?.length) batches.push({ label: 'core_ramparts', kind: 'static', entries: bp[5] });
    if (bp[6]?.length) batches.push({ label: 'nuker', kind: 'static', entries: bp[6] });
    if (bp[7]?.length) batches.push({ label: 'power_spawn', kind: 'static', entries: bp[7] });
  }

  return batches;
}

// ── Placing ──

/** Place all sites in a static batch, spawn-relative */
function placeStaticBatch(room: Room, spawn: StructureSpawn, entries: BlueprintEntry[]): number {
  let placed = 0;
  for (const entry of entries) {
    const x = spawn.pos.x + entry.x;
    const y = spawn.pos.y + entry.y;
    if (placeIfNew(room, x, y, entry.name)) placed++;
  }
  return placed;
}

/** Check if all construction sites from the current batch are built */
function batchComplete(room: Room): boolean {
  return Memory.planner.batchPlaced && room.find(FIND_CONSTRUCTION_SITES).length === 0;
}

// ── Main Entry ──

export function runConstructionPlanner(room: Room): void {
  const spawns = room.find(FIND_MY_SPAWNS);
  if (spawns.length === 0) return;
  const spawn = spawns[0];
  const rcl = room.controller?.level ?? 0;

  // Init
  if (!Memory.planner) Memory.planner = { rcl: 0, batch: 0, batchPlaced: false };

  // RCL changed → reset
  if (Memory.planner.rcl !== rcl) {
    Memory.planner.rcl = rcl;
    Memory.planner.batch = 0;
    Memory.planner.batchPlaced = false;
    console.log(`[planner] RCL ${rcl} — ${getBatches(rcl).length} batches queued`);
  }

  const batches = getBatches(rcl);

  // Safety: batch index out of bounds after code deployment changes batch lists
  if (Memory.planner.batch >= batches.length && batches.length > 0) {
    Memory.planner.batch = 0;
    Memory.planner.batchPlaced = false;
  }

  // No more batches for this RCL
  if (Memory.planner.batch >= batches.length) return;

  // Current batch complete → advance
  if (batchComplete(room)) {
    const oldLabel = batches[Memory.planner.batch].label;
    Memory.planner.batch++;
    Memory.planner.batchPlaced = false;
    console.log(`[planner] ✓ ${oldLabel} complete, advancing to batch ${Memory.planner.batch}`);

    if (Memory.planner.batch >= batches.length) {
      console.log(`[planner] All RCL ${rcl} batches complete`);
      return;
    }
  }

  // Place current batch
  if (!Memory.planner.batchPlaced) {
    const batch = batches[Memory.planner.batch];
    let placed = 0;

    if (batch.kind === 'static') {
      placed = placeStaticBatch(room, spawn, batch.entries);
    } else {
      placed = batch.place(room, spawn);
    }

    if (placed > 0) {
      console.log(`[planner] ${batch.label}: ${placed} sites placed`);
    }
    Memory.planner.batchPlaced = true;
  }
}
