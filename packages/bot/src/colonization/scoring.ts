/**
 * colonization/scoring.ts — Room evaluation for colonization
 *
 * Gating checks run first (room exists, 2+ sources). If passed,
 * precomputes swamp-aware distance maps from each POI to every tile
 * via Dial's algorithm, then exhaustively scans the room (every tile)
 * for blueprint fit. Each valid position is scored by its weighted
 * travel distances — sources weighted highest. Returns the optimal
 * spawn position, its travel-cost-based score, and a complete RoomScore.
 */

import { getBlueprintPositions } from '../blueprint';

export interface RoomScore {
  name: string;
  score: number;           // overall room score
  positionScore: number;   // travel-cost-based position score
  sources: number;
  worldX: number;          // optimal spawn x (room-local)
  worldY: number;          // optimal spawn y (room-local)
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

/** Result from the exhaustive spawn-position search */
interface SpawnResult {
  x: number;
  y: number;
  positionScore: number;
  travelCosts: {
    sources: number[];
    mineral: number;
    controller: number;
  };
}

const SWAMP_COST = 5;
const ROOM_SIZE = 50;
const MAX_DIST = ROOM_SIZE * SWAMP_COST + ROOM_SIZE; // safe upper bound for Dial buckets

// Position scoring weights — sources prioritized
const SOURCE_TRAVEL_WEIGHT = 10;
const MINERAL_TRAVEL_WEIGHT = 3;
const CONTROLLER_TRAVEL_WEIGHT = 3;

// Room-level bonuses
const SOURCE_COUNT_BONUS = 1000;

// Minimum sources required
const MIN_SOURCES = 2;

// ── Public API ──

/**
 * Score a room for colonization. Returns null if the room doesn't meet
 * minimum requirements (no room, no controller, fewer than MIN_SOURCES
 * sources, controller is claimed when requireUnclaimed is true,
 * controller is reserved when requireUnreserved is true,
 * or blueprint doesn't fit anywhere).
 *
 * @param requireUnclaimed If true (default), rejects rooms where the
 *   controller is already owned by any player.
 * @param requireUnreserved If true (default), rejects rooms where the
 *   controller is reserved by another player.
 */
export function scoreRoom(roomName: string, requireUnclaimed: boolean = true, requireUnreserved: boolean = true): RoomScore | null {
  const room = Game.rooms[roomName];
  if (!room) return null;

  // ── Gate checks ──

  // Always: room must have a controller
  const controller = room.controller;
  if (!controller) return null;

  // Optional: controller must be unclaimed
  if (requireUnclaimed && controller.owner) return null;

  // Optional: controller must be unreserved
  if (requireUnreserved && controller.reservation) return null;

  const sources = room.find(FIND_SOURCES);
  if (sources.length < MIN_SOURCES) return null;

  // Collect points of interest
  const pois: POI[] = [];
  for (const s of sources) pois.push({ type: 'source', x: s.pos.x, y: s.pos.y });
  const mineral = room.find(FIND_MINERALS)[0];
  if (mineral) pois.push({ type: 'mineral', x: mineral.pos.x, y: mineral.pos.y });
  pois.push({ type: 'controller', x: controller.pos.x, y: controller.pos.y });

  // Find optimal spawn position (exhaustive scan with position scoring)
  const result = findOptimalSpawn(room.name, pois);
  if (!result) return null;

  // Room-level score: position score + source count bonus
  let roomScore = result.positionScore + sources.length * SOURCE_COUNT_BONUS;

  // Soft penalty for hostile structures
  const hostiles = room.find(FIND_HOSTILE_STRUCTURES);
  if (hostiles.length > 0) roomScore = Math.floor(roomScore / 2);

  return {
    name: roomName,
    score: roomScore,
    positionScore: result.positionScore,
    sources: sources.length,
    worldX: result.x,
    worldY: result.y,
    travelCosts: result.travelCosts,
  };
}

// ── Distance map (Dial's algorithm) ──

/**
 * Precompute swamp-aware distances from (fromX, fromY) to every tile
 * in the room. Uses Dial's algorithm (bucket-based Dijkstra) since
 * edge weights are small integers (1 or 5). Returns a flat number[]
 * indexed by y*50+x for cache-friendly lookup during the scan.
 */
function computeDistanceMap(roomName: string, fromX: number, fromY: number): number[] {
  const dist = new Array<number>(ROOM_SIZE * ROOM_SIZE).fill(Infinity);
  const terrain = Game.map.getRoomTerrain(roomName);

  // Buckets indexed by distance
  const buckets: Array<Array<[number, number]>> = Array(MAX_DIST + 1);
  for (let i = 0; i <= MAX_DIST; i++) buckets[i] = [];

  const idx = (x: number, y: number) => y * ROOM_SIZE + x;
  dist[idx(fromX, fromY)] = 0;
  buckets[0].push([fromX, fromY]);

  let currentBucket = 0;

  while (currentBucket <= MAX_DIST) {
    // Advance to next non-empty bucket
    while (currentBucket <= MAX_DIST && buckets[currentBucket].length === 0) {
      currentBucket++;
    }
    if (currentBucket > MAX_DIST) break;

    const [x, y] = buckets[currentBucket].pop()!;
    const d = dist[idx(x, y)];
    if (d < currentBucket) continue; // stale entry

    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= ROOM_SIZE || ny < 0 || ny >= ROOM_SIZE) continue;
      if (terrain.get(nx, ny) === TERRAIN_MASK_WALL) continue;

      const edgeCost = terrain.get(nx, ny) === TERRAIN_MASK_SWAMP ? SWAMP_COST : 1;
      const nd = d + edgeCost;
      const ni = idx(nx, ny);
      if (nd < dist[ni]) {
        dist[ni] = nd;
        buckets[nd].push([nx, ny]);
      }
    }
  }

  return dist;
}

// ── Spawn position search ──

/**
 * Parse blueprint offsets from Set<string> ("x,y") to Array<{x,y}>.
 * The blueprint module returns a Set of comma-delimited coordinate strings.
 */
function parseBlueprintOffsets(): Array<{ x: number; y: number }> {
  const raw = getBlueprintPositions();
  const offsets: Array<{ x: number; y: number }> = [];
  for (const entry of raw) {
    const [xs, ys] = entry.split(',');
    offsets.push({ x: parseInt(xs, 10), y: parseInt(ys, 10) });
  }
  return offsets;
}

/**
 * Exhaustively scan every tile in the room. For each position where
 * the blueprint fits, compute the position score from precomputed
 * distance maps. Track and return the best.
 */
function findOptimalSpawn(roomName: string, pois: POI[]): SpawnResult | null {
  const bpOffsets = parseBlueprintOffsets();
  if (bpOffsets.length === 0) return null;

  // Precompute distance maps from each POI to all tiles
  const distMaps: number[][] = [];
  for (const poi of pois) {
    distMaps.push(computeDistanceMap(roomName, poi.x, poi.y));
  }

  const terrain = Game.map.getRoomTerrain(roomName);
  let best: SpawnResult | null = null;

  // Scan every tile
  for (let x = 1; x < 49; x++) {
    for (let y = 1; y < 49; y++) {
      if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
      if (!blueprintFits(terrain, x, y, bpOffsets)) continue;

      const result = scorePosition(x, y, pois, distMaps);
      if (!best || result.positionScore > best.positionScore) {
        best = result;
      }
    }
  }

  return best;
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

/** Score a candidate spawn position from precomputed distance maps */
function scorePosition(
  sx: number,
  sy: number,
  pois: POI[],
  distMaps: number[][],
): SpawnResult {
  const sourcesCosts: number[] = [];
  let mineralCost = 0;
  let controllerCost = 0;
  let positionScore = 0;

  const tileIdx = sy * ROOM_SIZE + sx;

  for (let i = 0; i < pois.length; i++) {
    const poi = pois[i];
    const d = distMaps[i][tileIdx];
    if (d === Infinity) return { x: sx, y: sy, positionScore: -Infinity, travelCosts: { sources: [], mineral: 0, controller: 0 } };

    if (poi.type === 'source') {
      sourcesCosts.push(d);
      positionScore -= d * SOURCE_TRAVEL_WEIGHT;
    } else if (poi.type === 'mineral') {
      mineralCost = d;
      positionScore -= d * MINERAL_TRAVEL_WEIGHT;
    } else {
      controllerCost = d;
      positionScore -= d * CONTROLLER_TRAVEL_WEIGHT;
    }
  }

  return {
    x: sx,
    y: sy,
    positionScore,
    travelCosts: { sources: sourcesCosts, mineral: mineralCost, controller: controllerCost },
  };
}
