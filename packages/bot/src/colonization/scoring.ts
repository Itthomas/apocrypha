/**
 * colonization/scoring.ts — Room evaluation for colonization
 *
 * Gating checks run first (room exists, 2+ sources). If passed,
 * collects all blueprint-fitting spawn positions, rough-ranks them
 * by Chebyshev proximity to sources, then scores the top candidates
 * using the built-in PathFinder.search for accurate swamp-aware costs.
 */

import { getBlueprintPositions } from '../blueprint';

export interface RoomScore {
  name: string;
  score: number;
  positionScore: number;
  sources: number;
  worldX: number;
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

const SOURCE_TRAVEL_WEIGHT = 10;
const MINERAL_TRAVEL_WEIGHT = 3;
const CONTROLLER_TRAVEL_WEIGHT = 3;

const SOURCE_COUNT_BONUS = 1000;
const MIN_SOURCES = 2;
const MAX_CANDIDATES = 20;

// ── Public API ──

export function scoreRoom(roomName: string, requireUnclaimed: boolean = true, requireUnreserved: boolean = true): RoomScore | null {
  const room = Game.rooms[roomName];
  if (!room) return null;

  const controller = room.controller;
  if (!controller) return null;

  if (requireUnclaimed && controller.owner) return null;

  if (requireUnreserved && controller.reservation) return null;

  const sources = room.find(FIND_SOURCES);
  if (sources.length < MIN_SOURCES) return null;

  const pois: POI[] = [];
  for (const s of sources) pois.push({ type: 'source', x: s.pos.x, y: s.pos.y });
  const mineral = room.find(FIND_MINERALS)[0];
  if (mineral) pois.push({ type: 'mineral', x: mineral.pos.x, y: mineral.pos.y });
  pois.push({ type: 'controller', x: controller.pos.x, y: controller.pos.y });

  const result = findOptimalSpawn(room.name, pois);
  if (!result) return null;

  let roomScore = result.positionScore + sources.length * SOURCE_COUNT_BONUS;

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

// ── Cost matrix ──

let _costsRoom = '';
let _costs: PathFinder.CostMatrix | null = null;

function getCostMatrix(roomName: string): PathFinder.CostMatrix {
  if (_costsRoom === roomName && _costs) return _costs;
  const costs = new PathFinder.CostMatrix();
  const terrain = Game.map.getRoomTerrain(roomName);
  for (let x = 0; x < ROOM_SIZE; x++) {
    for (let y = 0; y < ROOM_SIZE; y++) {
      const t = terrain.get(x, y);
      if (t === TERRAIN_MASK_WALL) costs.set(x, y, 255);
      else costs.set(x, y, t === TERRAIN_MASK_SWAMP ? SWAMP_COST : 1);
    }
  }
  _costsRoom = roomName;
  _costs = costs;
  return costs;
}

// ── Spawn position search ──

function parseBlueprintOffsets(): Array<{ x: number; y: number }> {
  const raw = getBlueprintPositions();
  const offsets: Array<{ x: number; y: number }> = [];
  for (const entry of raw) {
    const [xs, ys] = entry.split(',');
    offsets.push({ x: parseInt(xs, 10), y: parseInt(ys, 10) });
  }
  return offsets;
}

export function canFitBlueprint(roomName: string): boolean {
  const bpOffsets = parseBlueprintOffsets();
  if (bpOffsets.length === 0) return false;
  const terrain = Game.map.getRoomTerrain(roomName);
  for (let x = 1; x < 49; x++) {
    for (let y = 1; y < 49; y++) {
      if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
      if (blueprintFits(terrain, x, y, bpOffsets)) return true;
    }
  }
  return false;
}

function findOptimalSpawn(roomName: string, pois: POI[]): SpawnResult | null {
  const bpOffsets = parseBlueprintOffsets();
  if (bpOffsets.length === 0) return null;

  const costs = getCostMatrix(roomName);
  const terrain = Game.map.getRoomTerrain(roomName);

  // Collect all blueprint-fitting positions
  const candidates: Array<{ x: number; y: number }> = [];
  for (let x = 1; x < 49; x++) {
    for (let y = 1; y < 49; y++) {
      if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
      if (!blueprintFits(terrain, x, y, bpOffsets)) continue;
      candidates.push({ x, y });
    }
  }

  if (candidates.length === 0) return null;

  // Rough-rank by Chebyshev proximity to first source (cheap, no pathfinding)
  const src = pois[0];
  candidates.sort((a, b) => {
    const da = Math.max(Math.abs(a.x - src.x), Math.abs(a.y - src.y));
    const db = Math.max(Math.abs(b.x - src.x), Math.abs(b.y - src.y));
    return da - db;
  });

  const topN = candidates.slice(0, MAX_CANDIDATES);

  let best: SpawnResult | null = null;
  for (const { x, y } of topN) {
    const result = scorePosition(x, y, pois, costs, roomName);
    if (!best || result.positionScore > best.positionScore) {
      best = result;
    }
  }

  return best;
}

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

function scorePosition(
  sx: number,
  sy: number,
  pois: POI[],
  costs: PathFinder.CostMatrix,
  roomName: string,
): SpawnResult {
  const sourcesCosts: number[] = [];
  let mineralCost = 0;
  let controllerCost = 0;
  let positionScore = 0;

  const start = new RoomPosition(sx, sy, roomName);

  for (const poi of pois) {
    const goal = { pos: new RoomPosition(poi.x, poi.y, roomName), range: 1 };
    const result = PathFinder.search(start, goal, {
      roomCallback: () => costs,
      maxOps: 2000,
      maxRooms: 1,
    });

    const d = result.incomplete ? Infinity : result.cost;

    if (d === Infinity) {
      return { x: sx, y: sy, positionScore: -Infinity, travelCosts: { sources: [], mineral: 0, controller: 0 } };
    }

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

