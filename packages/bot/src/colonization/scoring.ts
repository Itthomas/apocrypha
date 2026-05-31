/**
 * colonization/scoring.ts — Room evaluation for colonization
 *
 * For a given room, finds the best spawn position by checking blueprint
 * fit against terrain, counts sources, and computes swamp-aware travel
 * costs from the ideal spawn to each point of interest.
 */

import { BLUEPRINT } from '../blueprint';
import { getBlueprintPositions } from '../blueprint';

export interface RoomScore {
  name: string;
  score: number;
  sources: number;
  worldX: number;       // ideal spawn world coordinates
  worldY: number;
  travelCosts: {
    sources: number[];
    mineral: number;
    controller: number;
  };
}

interface POI {
  type: 'source' | 'mineral' | 'controller';
  x: number;
  y: number;
}

const SWAMP_COST = 5;   // swamp multiplies base move cost
const SOURCE_WEIGHT = 1000;
const TRAVEL_WEIGHT = 10;
const CONTROLLER_BONUS = 200;

/**
 * Score a room for colonization. Returns null if the room doesn't meet
 * minimum requirements (at least 2 sources, blueprint fits somewhere).
 */
export function scoreRoom(roomName: string): RoomScore | null {
  // Can't use Game.rooms for unscouted rooms — must use Game.map.getRoomTerrain
  // But we CAN use Game.rooms if the scout is currently in the room.
  // For now, assume called while scout IS in the room.

  // We need a Game.rooms reference — this function must be called from within
  // the scout's run() when it enters a new room.
  const room = Game.rooms[roomName];
  if (!room) return null;

  const sources = room.find(FIND_SOURCES);
  if (sources.length < 2) return null; // hard gate

  // Find best spawn position by blueprint fit
  const spawnPos = findBestSpawnPosition(room);
  if (!spawnPos) return null; // blueprint doesn't fit anywhere

  // Collect points of interest
  const pois: POI[] = [];
  for (const s of sources) pois.push({ type: 'source', x: s.pos.x, y: s.pos.y });
  const mineral = room.find(FIND_MINERALS)[0];
  if (mineral) pois.push({ type: 'mineral', x: mineral.pos.x, y: mineral.pos.y });
  const controller = room.controller;
  if (controller) pois.push({ type: 'controller', x: controller.pos.x, y: controller.pos.y });

  // Compute swamp-aware travel costs from spawn to each POI
  const travelCosts = computeTravelCosts(room, spawnPos.x, spawnPos.y, pois);

  // Score formula
  let score = sources.length * SOURCE_WEIGHT;

  const totalTravel =
    sum(travelCosts.sources) +
    travelCosts.mineral +
    travelCosts.controller;
  score -= totalTravel * TRAVEL_WEIGHT;

  // Controller proximity bonus
  if (travelCosts.controller < 5) score += CONTROLLER_BONUS;

  // Soft penalty for hostile structures
  const hostiles = room.find(FIND_HOSTILE_STRUCTURES);
  if (hostiles.length > 0) score = Math.floor(score / 2);

  // Convert room coords to world coords
  const worldX = spawnPos.x;
  const worldY = spawnPos.y;

  return {
    name: roomName,
    score,
    sources: sources.length,
    worldX,
    worldY,
    travelCosts,
  };
}

// ── Spawn position search ──

const SEARCH_STEP = 3; // check every 3rd tile, then fine-tune

/**
 * Find the best position in the room to place our spawn such that
 * all blueprint structures fit on non-wall terrain.
 *
 * Strategy: scan the room in a grid with step=3, check blueprint fit
 * at each position. Return the first valid position found (center-
 * biased by scanning from controller outward later if needed).
 */
function findBestSpawnPosition(room: Room): { x: number; y: number } | null {
  // Collect all blueprint positions (relative offsets from spawn)
  const bpOffsets = getBlueprintPositions();
  if (bpOffsets.length === 0) return null;

  const terrain = Game.map.getRoomTerrain(room.name);

  // Scan room with grid step
  for (let x = SEARCH_STEP; x < 49; x += SEARCH_STEP) {
    for (let y = SEARCH_STEP; y < 49; y += SEARCH_STEP) {
      if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;

      if (blueprintFits(terrain, x, y, bpOffsets)) {
        return { x, y };
      }
    }
  }

  return null;
}

/** Check if all blueprint offsets fit at the given spawn anchor */
function blueprintFits(
  terrain: RoomTerrain,
  spawnX: number,
  spawnY: number,
  offsets: Array<{ x: number; y: number }>,
): boolean {
  for (const off of offsets) {
    const tx = spawnX + off.x;
    const ty = spawnY + off.y;
    if (tx < 1 || tx > 48 || ty < 1 || ty > 48) return false;
    if (terrain.get(tx, ty) === TERRAIN_MASK_WALL) return false;
  }
  return true;
}

// ── Travel cost computation ──

function computeTravelCosts(
  room: Room,
  sx: number,
  sy: number,
  pois: POI[],
): { sources: number[]; mineral: number; controller: number } {
  const sourceCosts: number[] = [];
  let mineralCost = 0;
  let controllerCost = 0;

  const start = new RoomPosition(sx, sy, room.name);

  for (const poi of pois) {
    const dest = new RoomPosition(poi.x, poi.y, room.name);
    const cost = pathCost(start, dest, room);
    if (poi.type === 'source') sourceCosts.push(cost);
    else if (poi.type === 'mineral') mineralCost = cost;
    else controllerCost = cost;
  }

  return { sources: sourceCosts, mineral: mineralCost, controller: controllerCost };
}

/**
 * Compute a swamp-aware travel cost from start to dest.
 * Uses PathFinder with swamp cost weighting for accuracy.
 * Returns a composite cost (plain tiles + swamp×SWAMP_COST).
 */
function pathCost(start: RoomPosition, dest: RoomPosition, room: Room): number {
  const result = PathFinder.search(start, { pos: dest, range: 1 }, {
    roomCallback: (rn: string) => {
      if (rn !== room.name) return false;
      const costs = new PathFinder.CostMatrix();
      const terrain = Game.map.getRoomTerrain(rn);
      for (let x = 1; x < 49; x++) {
        for (let y = 1; y < 49; y++) {
          const t = terrain.get(x, y);
          if (t === TERRAIN_MASK_WALL) costs.set(x, y, 255);
          else if (t === TERRAIN_MASK_SWAMP) costs.set(x, y, SWAMP_COST);
          else costs.set(x, y, 1);
        }
      }
      return costs;
    },
    maxOps: 2000,
  });

  if (result.incomplete) return 50; // fallback estimate

  // Sum path cost accounting for swamp weighting
  let cost = 0;
  for (let i = 1; i < result.path.length; i++) {
    const p = result.path[i];
    const t = Game.map.getRoomTerrain(room.name).get(p.x, p.y);
    cost += t === TERRAIN_MASK_SWAMP ? SWAMP_COST : 1;
  }
  return cost;
}

function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}
