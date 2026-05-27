/**
 * constructionPlanner.ts — Apocrypha Construction Planner
 *
 * Places construction sites for infrastructure as the room levels up.
 * Extensions are laid out in a spiral ring around the spawn for efficient pathfinding.
 * Runs once per RCL milestone; sites persist until built.
 */

/** Extension placements per RCL (Screeps CONTROLLER_STRUCTURES) */
const EXTENSIONS_PER_RCL: Record<number, number> = {
  0: 0, 1: 0, 2: 5, 3: 10, 4: 20, 5: 30, 6: 40, 7: 50, 8: 60
};

/** Track which RCL we last placed sites for */
interface PlannerMemory {
  placedRcl?: number;
}

/**
 * Generate spiral positions around a center point.
 * Returns positions in a ring at the given radius.
 */
function ringPositions(cx: number, cy: number, radius: number, count: number): Array<{x: number, y: number}> {
  const positions: Array<{x: number, y: number}> = [];
  for (let i = 0; i < count; i++) {
    const angle = (2 * Math.PI * i) / count;
    const x = Math.round(cx + radius * Math.cos(angle));
    const y = Math.round(cy + radius * Math.sin(angle));
    positions.push({ x, y });
  }
  return positions;
}

/**
 * Check if a position is valid for building (not on a wall, not on existing structures).
 */
function isBuildable(room: Room, x: number, y: number): boolean {
  // Bounds check
  if (x < 1 || x > 48 || y < 1 || y > 48) return false;

  // Check terrain — not a wall
  const terrain = Game.map.getRoomTerrain(room.name);
  if (terrain.get(x, y) === TERRAIN_MASK_WALL) return false;

  // Check existing structures at this position
  const structures = room.lookForAt(LOOK_STRUCTURES, x, y);
  if (structures.length > 0) return false;

  // Check construction sites at this position
  const sites = room.lookForAt(LOOK_CONSTRUCTION_SITES, x, y);
  if (sites.length > 0) return false;

  return true;
}

/**
 * Place extension construction sites around the spawn.
 * Uses concentric rings: radius 2 for first 8, radius 3 for next batch, etc.
 */
function placeExtensions(room: Room, desired: number): number {
  const spawn = room.find(FIND_MY_SPAWNS)[0];
  if (!spawn) return 0;

  // Count existing extension sites + built extensions
  const existingSites = room.find(FIND_CONSTRUCTION_SITES).filter(
    s => s.structureType === STRUCTURE_EXTENSION
  ).length;
  const existingBuilt = room.find(FIND_MY_STRUCTURES).filter(
    s => s.structureType === STRUCTURE_EXTENSION
  ).length;
  const existing = existingSites + existingBuilt;

  const toPlace = desired - existing;
  if (toPlace <= 0) return 0;

  let placed = 0;
  const cx = spawn.pos.x;
  const cy = spawn.pos.y;

  // Try concentric rings until we place enough
  for (let radius = 2; radius <= 5 && placed < toPlace; radius++) {
    const circumference = Math.max(8, radius * 6);
    const candidates = ringPositions(cx, cy, radius, circumference);

    for (const pos of candidates) {
      if (placed >= toPlace) break;
      if (isBuildable(room, pos.x, pos.y)) {
        const result = room.createConstructionSite(pos.x, pos.y, STRUCTURE_EXTENSION);
        if (result === OK) {
          placed++;
        }
      }
    }
  }

  if (placed > 0) {
    console.log(`[planner] Placed ${placed} extension sites in ${room.name} (target: ${desired})`);
  }

  return placed;
}

/**
 * Place road construction sites between spawn and sources for efficiency.
 */
function placeRoads(room: Room): number {
  const spawn = room.find(FIND_MY_SPAWNS)[0];
  const sources = room.find(FIND_SOURCES);
  if (!spawn || sources.length === 0) return 0;

  let placed = 0;

  for (const source of sources) {
    const path = room.findPath(spawn.pos, source.pos, {
      ignoreCreeps: true,
      ignoreRoads: true, // don't double-place
      swampCost: 1
    });

    for (const step of path) {
      // Only place on swamp or plain where there's no road yet
      const terrain = Game.map.getRoomTerrain(room.name);
      const tileType = terrain.get(step.x, step.y);

      // Check if road already exists or is under construction
      const structures = room.lookForAt(LOOK_STRUCTURES, step.x, step.y);
      const sites = room.lookForAt(LOOK_CONSTRUCTION_SITES, step.x, step.y);
      const hasRoad = structures.some(s => s.structureType === STRUCTURE_ROAD);
      const hasSite = sites.some(s => s.structureType === STRUCTURE_ROAD);

      if (!hasRoad && !hasSite) {
        const result = room.createConstructionSite(step.x, step.y, STRUCTURE_ROAD);
        if (result === OK) placed++;
      }
    }
  }

  if (placed > 0) {
    console.log(`[planner] Placed ${placed} road sites in ${room.name}`);
  }

  return placed;
}

/**
 * Main planner entry. Call once per tick from main loop.
 * Places extension sites when RCL changes, roads once at RCL 2+.
 */
export function runConstructionPlanner(room: Room): void {
  const rcl = room.controller?.level ?? 0;
  const mem = Memory as unknown as { planner?: PlannerMemory } || {};
  if (!mem.planner) {
    mem.planner = { placedRcl: 0 };
  }

  // Only run when RCL increases (once per level)
  if (mem.planner.placedRcl! >= rcl) return;

  const desiredExtensions = EXTENSIONS_PER_RCL[rcl] || 0;

  // Place extension sites
  if (desiredExtensions > 0) {
    placeExtensions(room, desiredExtensions);
  }

  // Place roads at RCL 2+ (one-time)
  if (rcl >= 2 && mem.planner.placedRcl! < 2) {
    placeRoads(room);
  }

  mem.planner.placedRcl = rcl;
}
