/**
 * constructionPlanner.ts — Apocrypha Construction Planner
 *
 * Places construction sites in sequential batches per RCL level.
 * Only ONE batch is active at a time — the next batch is created only
 * after all sites from the current batch are completely built.
 *
 * This means creeps never need to sort by priority; all current
 * construction sites are equal priority. They just build the nearest one.
 *
 * Batches by RCL:
 *   RCL 1: [roads]
 *   RCL 2: [5 extensions], [roads fill]
 *   RCL 3: [2 source containers], [5 more extensions], [tower], [spawn overflow, controller container]
 *   RCL 4+: [storage], [remaining extensions]
 */

interface PlannerMemory {
  rcl: number;
  /** Current batch number (0-based, resets on RCL change) */
  batch: number;
  /** Whether the current batch has been placed */
  batchPlaced: boolean;
}

type BatchFn = (room: Room) => number; // returns number of sites placed

/** Place a construction site if one doesn't already exist at that position */
function placeIfNew(room: Room, x: number, y: number, type: BuildableStructureConstant): boolean {
  const existing = room.lookForAt(LOOK_CONSTRUCTION_SITES, x, y);
  if (existing.length > 0) return false;
  const structures = room.lookForAt(LOOK_STRUCTURES, x, y);
  if (structures.length > 0 && structures[0].structureType === type) return false;
  return room.createConstructionSite(x, y, type) === OK;
}

/** Count existing construction sites of a given type */
function countSites(room: Room, type: BuildableStructureConstant): number {
  return room.find(FIND_CONSTRUCTION_SITES, { filter: s => s.structureType === type }).length;
}

/** Count built structures of a given type */
function countBuilt(room: Room, type: BuildableStructureConstant): number {
  return room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === type }).length;
}

/** Place roads from spawn to each target */
function placeRoads(room: Room, targets: RoomPosition[]): number {
  const spawns = room.find(FIND_MY_SPAWNS);
  if (spawns.length === 0) return 0;
  let placed = 0;
  for (const target of targets) {
    const path = room.findPath(spawns[0].pos, target, { ignoreCreeps: true, swampCost: 1 });
    for (const step of path) {
      if (placeIfNew(room, step.x, step.y, STRUCTURE_ROAD)) placed++;
    }
  }
  return placed;
}

/** Place extension sites in ring around spawn */
function placeExtensions(room: Room, targetTotal: number): number {
  const existing = countBuilt(room, STRUCTURE_EXTENSION) + countSites(room, STRUCTURE_EXTENSION);
  const toPlace = Math.max(0, targetTotal - existing);
  if (toPlace === 0) return 0;

  const spawns = room.find(FIND_MY_SPAWNS);
  if (spawns.length === 0) return 0;
  const spawn = spawns[0];

  let placed = 0;
  for (let r = 1; r <= 5 && placed < toPlace; r++) {
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

/** Place containers adjacent to each source */
function placeSourceContainers(room: Room): number {
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
        if (x < 1 || x > 48 || y < 1 || y > 48) continue;
        if (room.getTerrain().get(x, y) !== TERRAIN_MASK_WALL) {
          if (placeIfNew(room, x, y, STRUCTURE_CONTAINER)) { placed++; break; }
        }
      }
      if (placed > 0) break;
    }
  }
  return placed;
}

/** Place a single tower */
function placeTower(room: Room): number {
  const count = countBuilt(room, STRUCTURE_TOWER) + countSites(room, STRUCTURE_TOWER);
  const maxT = room.controller?.level ?? 0 >= 8 ? 6 : room.controller?.level ?? 0 >= 7 ? 3 : room.controller?.level ?? 0 >= 5 ? 2 : 1;
  if (count >= maxT) return 0;

  const spawns = room.find(FIND_MY_SPAWNS);
  if (spawns.length === 0) return 0;
  for (let dx = -3; dx <= 3; dx++) {
    for (let dy = -3; dy <= 3; dy++) {
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) continue;
      const x = spawns[0].pos.x + dx;
      const y = spawns[0].pos.y + dy;
      if (x < 1 || x > 48 || y < 1 || y > 48) continue;
      if (placeIfNew(room, x, y, STRUCTURE_TOWER)) return 1;
    }
  }
  return 0;
}

/** Place spawn overflow container (for builders) */
function placeOverflowContainer(room: Room): number {
  const spawns = room.find(FIND_MY_SPAWNS);
  if (spawns.length === 0) return 0;
  const existing = spawns[0].pos.findInRange(FIND_STRUCTURES, 3, {
    filter: s => s.structureType === STRUCTURE_CONTAINER
  });
  if (existing.length > 0) return 0;

  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      if (dx === 0 && dy === 0) continue;
      const x = spawns[0].pos.x + dx;
      const y = spawns[0].pos.y + dy;
      if (x < 1 || x > 48 || y < 1 || y > 48) continue;
      if (placeIfNew(room, x, y, STRUCTURE_CONTAINER)) return 1;
    }
  }
  return 0;
}

/** Place controller container */
function placeControllerContainer(room: Room): number {
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
      if (x < 1 || x > 48 || y < 1 || y > 48) continue;
      if (placeIfNew(room, x, y, STRUCTURE_CONTAINER)) return 1;
    }
  }
  return 0;
}

/** Place storage */
function placeStorage(room: Room): number {
  if (countBuilt(room, STRUCTURE_STORAGE) + countSites(room, STRUCTURE_STORAGE) > 0) return 0;
  const spawns = room.find(FIND_MY_SPAWNS);
  if (spawns.length === 0) return 0;
  if (placeIfNew(room, spawns[0].pos.x + 2, spawns[0].pos.y + 2, STRUCTURE_STORAGE)) return 1;
  return 0;
}

// ── Batch definitions ──

/** Get the list of batches for a given RCL */
function getBatches(rcl: number): BatchFn[] {
  const batches: BatchFn[] = [];

  // RCL 1: Roads
  if (rcl >= 1) {
    batches.push((room: Room) => {
      const targets: RoomPosition[] = [];
      for (const source of room.find(FIND_SOURCES)) targets.push(source.pos);
      if (room.controller) targets.push(room.controller.pos);
      return placeRoads(room, targets);
    });
  }

  // RCL 2: Extensions + fill roads
  if (rcl >= 2) {
    batches.push((room: Room) => placeExtensions(room, 5));
    batches.push((room: Room) => {
      const targets: RoomPosition[] = [];
      for (const source of room.find(FIND_SOURCES)) targets.push(source.pos);
      if (room.controller) targets.push(room.controller.pos);
      return placeRoads(room, targets);
    });
  }

  // RCL 3: Source containers, more extensions, tower, overflow, controller container
  if (rcl >= 3) {
    batches.push(placeSourceContainers);
    batches.push((room: Room) => placeExtensions(room, 10));
    batches.push(placeTower);
    batches.push(placeOverflowContainer);
    batches.push(placeControllerContainer);
  }

  // RCL 4+: Storage + full extensions
  if (rcl >= 4) {
    batches.push(placeStorage);
    batches.push((room: Room) => placeExtensions(room, 20));
  }

  // RCL 5+: More extensions
  if (rcl >= 5) {
    batches.push((room: Room) => placeExtensions(room, 30));
  }

  // RCL 7+: Full extensions
  if (rcl >= 7) {
    batches.push((room: Room) => placeExtensions(room, rcl >= 8 ? 60 : 50));
  }

  return batches;
}

/** Check if all construction sites from the current batch are built */
function batchComplete(room: Room): boolean {
  return room.find(FIND_CONSTRUCTION_SITES).length === 0;
}

// ── Main entry ──

export function runConstructionPlanner(room: Room): void {
  const rcl = room.controller?.level ?? 0;

  // Init
  if (!Memory.planner) Memory.planner = { rcl: 0, batch: 0, batchPlaced: false };

  // RCL changed → reset batches
  if (Memory.planner.rcl !== rcl) {
    Memory.planner.rcl = rcl;
    Memory.planner.batch = 0;
    Memory.planner.batchPlaced = false;
  }

  const batches = getBatches(rcl);

  // No batches for this RCL
  if (Memory.planner.batch >= batches.length) return;

  // If current batch is complete, advance to next
  if (batchComplete(room)) {
    Memory.planner.batch++;
    Memory.planner.batchPlaced = false;
    console.log(`[planner] Batch ${Memory.planner.batch - 1} complete, advancing to batch ${Memory.planner.batch}`);
    if (Memory.planner.batch >= batches.length) {
      console.log(`[planner] All RCL ${rcl} batches complete`);
      return;
    }
  }

  // Place current batch if not yet placed
  if (!Memory.planner.batchPlaced) {
    const batchFn = batches[Memory.planner.batch];
    const placed = batchFn(room);
    if (placed > 0) {
      console.log(`[planner] RCL ${rcl} batch ${Memory.planner.batch}: ${placed} sites placed`);
    }
    Memory.planner.batchPlaced = true;
  }
}
