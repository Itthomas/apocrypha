/**
 * constructionPlanner.ts — Apocrypha Construction Planner
 *
 * Places construction sites based on RCL milestones and build priority.
 * Run once per tick — only places new sites when quota is unfilled.
 *
 * Priority by RCL:
 *   RCL 1: roads (spawn→sources, spawn→controller)
 *   RCL 2: 5 extensions, roads
 *   RCL 3: 2 source containers, 5 more extensions, 1 tower, 1 spawn overflow container, 1 controller container
 *   RCL 4: storage, remaining extensions
 *   RCL 5+: links, more extensions, towers
 */

interface PlannerMemory {
  rcl: number;
  placed: Record<string, boolean>;
}

/** Place a construction site if one doesn't already exist at that position */
function placeIfNew(room: Room, x: number, y: number, type: BuildableStructureConstant): boolean {
  const existing = room.lookForAt(LOOK_CONSTRUCTION_SITES, x, y);
  if (existing.length > 0) return false;
  const structures = room.lookForAt(LOOK_STRUCTURES, x, y);
  if (structures.length > 0 && structures[0].structureType === type) return false;
  return room.createConstructionSite(x, y, type) === OK;
}

/** Place roads along a straight-ish path */
function placeRoads(room: Room, from: RoomPosition, to: RoomPosition): number {
  let placed = 0;
  const path = room.findPath(from, to, { ignoreCreeps: true, swampCost: 1 });
  for (const step of path) {
    if (placeIfNew(room, step.x, step.y, STRUCTURE_ROAD)) placed++;
  }
  return placed;
}

/** Place extension sites in a ring around the spawn */
function placeExtensions(room: Room, count: number): number {
  const spawns = room.find(FIND_MY_SPAWNS);
  if (spawns.length === 0) return 0;

  const spawn = spawns[0];
  const existing = room.find(FIND_MY_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_EXTENSION
  }).length;
  const existingSites = room.find(FIND_CONSTRUCTION_SITES, {
    filter: s => s.structureType === STRUCTURE_EXTENSION
  }).length;
  const toPlace = Math.max(0, count - existing - existingSites);

  let placed = 0;
  // Spiral out from spawn placing extensions on open tiles
  for (let r = 1; r <= 5 && placed < toPlace; r++) {
    for (let dx = -r; dx <= r && placed < toPlace; dx++) {
      for (let dy = -r; dy <= r && placed < toPlace; dy++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue; // ring only
        const x = spawn.pos.x + dx;
        const y = spawn.pos.y + dy;
        if (x < 1 || x > 48 || y < 1 || y > 48) continue;
        if (placeIfNew(room, x, y, STRUCTURE_EXTENSION)) placed++;
      }
    }
  }
  return placed;
}

/** Place a container adjacent to a source */
function placeSourceContainers(room: Room): number {
  const sources = room.find(FIND_SOURCES);
  let placed = 0;
  for (const source of sources) {
    // Check if container already exists adjacent
    const nearby = source.pos.findInRange(FIND_STRUCTURES, 1, {
      filter: s => s.structureType === STRUCTURE_CONTAINER
    });
    const nearbySites = source.pos.findInRange(FIND_CONSTRUCTION_SITES, 1, {
      filter: s => s.structureType === STRUCTURE_CONTAINER
    });
    if (nearby.length > 0 || nearbySites.length > 0) continue;

    // Find an open adjacent tile (prefer non-swamp, non-wall)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const x = source.pos.x + dx;
        const y = source.pos.y + dy;
        if (x < 1 || x > 48 || y < 1 || y > 48) continue;
        const terrain = room.getTerrain().get(x, y);
        if (terrain !== TERRAIN_MASK_WALL) {
          if (placeIfNew(room, x, y, STRUCTURE_CONTAINER)) {
            placed++;
            break; // one container per source
          }
        }
      }
      if (placed > 0) break;
    }
  }
  return placed;
}

/** Place container near spawn for overflow energy (builders use) */
function placeSpawnOverflowContainer(room: Room): number {
  const spawns = room.find(FIND_MY_SPAWNS);
  if (spawns.length === 0) return 0;

  // Check if one already exists within 3 tiles
  const existing = spawns[0].pos.findInRange(FIND_STRUCTURES, 3, {
    filter: s => s.structureType === STRUCTURE_CONTAINER
  });
  if (existing.length > 0) return 0;

  // Place on nearest open tile to spawn
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

/** Place container near controller for upgrader */
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

export function runConstructionPlanner(room: Room): void {
  const rcl = room.controller?.level ?? 0;

  // Initialize or detect RCL change
  if (!Memory.planner) Memory.planner = { rcl: 0, placed: {} };
  const plannerMemory = Memory.planner as PlannerMemory;
  const rclChanged = plannerMemory.rcl !== rcl;
  if (rclChanged) {
    plannerMemory.rcl = rcl;
    plannerMemory.placed = {};
  }

  const key = (type: string) => `${type}_rcl${rcl}`;

  // RCL 1+: Roads to sources and controller
  if (!plannerMemory.placed[key('roads')]) {
    const spawns = room.find(FIND_MY_SPAWNS);
    if (spawns.length > 0) {
      let placed = 0;
      for (const source of room.find(FIND_SOURCES)) {
        placed += placeRoads(room, spawns[0].pos, source.pos);
      }
      if (room.controller) {
        placed += placeRoads(room, spawns[0].pos, room.controller.pos);
      }
      if (placed > 0) console.log(`[planner] ${placed} road sites at RCL ${rcl}`);
    }
    plannerMemory.placed[key('roads')] = true;
  }

  // RCL 2+: Extensions
  if (rcl >= 2 && !plannerMemory.placed[key('extensions')]) {
    const maxExt = rcl >= 8 ? 60 : rcl >= 7 ? 50 : rcl >= 6 ? 40 : rcl >= 5 ? 30 : rcl >= 4 ? 20 : rcl >= 3 ? 10 : 5;
    const placed = placeExtensions(room, maxExt);
    if (placed > 0) console.log(`[planner] ${placed} extension sites at RCL ${rcl}`);
    if (placed === 0) plannerMemory.placed[key('extensions')] = true; // all done
  }

  // RCL 3+: Source containers
  if (rcl >= 3 && !plannerMemory.placed[key('sourceContainers')]) {
    const placed = placeSourceContainers(room);
    if (placed > 0) console.log(`[planner] ${placed} source container sites`);
    plannerMemory.placed[key('sourceContainers')] = true;
  }

  // RCL 3+: Tower
  if (rcl >= 3 && !plannerMemory.placed[key('tower')]) {
    const towers = room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_TOWER });
    const towerSites = room.find(FIND_CONSTRUCTION_SITES, { filter: s => s.structureType === STRUCTURE_TOWER });
    const maxT = rcl >= 8 ? 6 : rcl >= 7 ? 3 : rcl >= 5 ? 2 : 1;
    if (towers.length + towerSites.length < maxT) {
      const spawns = room.find(FIND_MY_SPAWNS);
      if (spawns.length > 0) {
        for (let dx = -3; dx <= 3; dx++) {
          for (let dy = -3; dy <= 3; dy++) {
            if (Math.abs(dx) < 2 && Math.abs(dy) < 2) continue; // not too close to spawn
            const x = spawns[0].pos.x + dx;
            const y = spawns[0].pos.y + dy;
            if (x < 1 || x > 48 || y < 1 || y > 48) continue;
            if (placeIfNew(room, x, y, STRUCTURE_TOWER)) {
              console.log(`[planner] Tower site at RCL ${rcl}`);
              plannerMemory.placed[key('tower')] = true;
              return;
            }
          }
        }
      }
    }
  }

  // RCL 3+: Spawn overflow container (for builders/upgraders to withdraw from)
  if (rcl >= 3 && !plannerMemory.placed[key('spawnOverflow')]) {
    placeSpawnOverflowContainer(room);
    plannerMemory.placed[key('spawnOverflow')] = true;
  }

  // RCL 3+: Controller container
  if (rcl >= 3 && !plannerMemory.placed[key('ctrlContainer')]) {
    placeControllerContainer(room);
    plannerMemory.placed[key('ctrlContainer')] = true;
  }

  // RCL 4+: Storage
  if (rcl >= 4 && !plannerMemory.placed[key('storage')]) {
    const storage = room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_STORAGE });
    if (storage.length === 0) {
      const spawns = room.find(FIND_MY_SPAWNS);
      if (spawns.length > 0) {
        placeIfNew(room, spawns[0].pos.x + 2, spawns[0].pos.y + 2, STRUCTURE_STORAGE);
      }
    }
    plannerMemory.placed[key('storage')] = true;
  }
}
