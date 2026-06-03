/**
 * roles/attacker.ts — Solo attacker creep
 *
 * Travels to target room via findRoute routing. Every tick (even in
 * transit), attacks highest-priority hostile within range while moving
 * toward the closest target of that priority.
 *
 * Two-pass targeting:
 *   Pass 1: Clear all reachable targets in priority order. Moves
 *     through tiers 1-6, attacking and moving toward closest reachable
 *     target on each tick.
 *   Pass 2: When all reachable targets are destroyed, tunnel through
 *     walls/ramparts using a CostMatrix weighted by structure health
 *     to reach the highest-priority unreachable targets.
 *
 * Target priority ladder:
 *   1. Towers
 *   2. Spawns
 *   3. Creeps with ATTACK parts
 *   4. Creeps with RANGED_ATTACK parts
 *   5. Any other hostile creeps
 *   6. Other structures (not roads, walls, ramparts)
 *   7. Walls & ramparts (lowest, only when nothing else remains)
 *
 * Roads are never targeted.
 */

import { travelToRoom } from '../lib/travel';

interface AttackerMemory {
  role: 'attacker';
  targetRoom: string;
  route?: Array<{ exit: ExitConstant; room: string }>;
  routeRoom?: string;
  lastRoom?: string;
}

type Attackable = AnyCreep | AnyStructure;

const TUNNEL_STRUCTURES: Set<BuildableStructureConstant> = new Set([
  STRUCTURE_WALL, STRUCTURE_RAMPART,
]);

const IGNORE_STRUCTURES: Set<BuildableStructureConstant> = new Set([
  STRUCTURE_ROAD,
]);

export function run(creep: Creep): boolean {
  const mem = creep.memory as AttackerMemory;
  mem.lastRoom = creep.room.name;

  // Not in target room → travel there, attack anything in range along the way
  if (creep.room.name !== mem.targetRoom) {
    const tiers = getPriorityTiers(creep);
    for (const tier of tiers) {
      const inRange = tier.filter(t => creep.pos.inRangeTo(t.pos, 1));
      if (inRange.length > 0) { creep.attack(inRange[0] as any); break; }
    }
    travelToRoom(creep, mem.targetRoom, true);
    return true;
  }

  // ── In target room ──
  const tiers = getPriorityTiers(creep);

  // Pass 1: find highest-priority tier with reachable targets
  for (let i = 0; i < tiers.length - 1; i++) {
    const tier = tiers[i];
    if (tier.length === 0) continue;

    const closest = creep.pos.findClosestByPath(tier as any) as unknown as Attackable;
    if (closest) {
      // Attack closest in-range target from this tier
      const inRange = tier.filter(t => creep.pos.inRangeTo(t.pos, 1));
      if (inRange.length > 0) creep.attack(inRange[0] as any);
      // Move toward closest reachable target
      creep.moveTo(closest as any);
      return true;
    }
  }

  // Pass 2: all reachable targets cleared — tunnel to highest-priority unreachable
  for (let i = 0; i < tiers.length - 1; i++) {
    const tier = tiers[i];
    if (tier.length === 0) continue;

    const best = findBestTunnelTarget(creep, tier);
    if (best) {
      walkTunnelPath(creep, best.path);
      return true;
    }
  }

  // Tier 7: walls/ramparts — nothing else remains
  const wallsRamparts = tiers[tiers.length - 1];
  if (wallsRamparts.length > 0) {
    const inRange = wallsRamparts.filter(t => creep.pos.inRangeTo(t.pos, 1));
    if (inRange.length > 0) creep.attack(inRange[0] as any);
    const closest = creep.pos.findClosestByPath(wallsRamparts as any) as unknown as Attackable;
    if (closest) creep.moveTo(closest as any);
    return true;
  }

  return true;
}

// ── Priority ladder ──

function getPriorityTiers(creep: Creep): Attackable[][] {
  const hostileCreeps = creep.room.find(FIND_HOSTILE_CREEPS);
  const hostileStructures = creep.room.find(FIND_HOSTILE_STRUCTURES)
    .filter(s => !IGNORE_STRUCTURES.has(s.structureType));

  return [
    hostileStructures.filter(s => s.structureType === STRUCTURE_TOWER),
    hostileStructures.filter(s => s.structureType === STRUCTURE_SPAWN),
    hostileCreeps.filter(c => c.getActiveBodyparts(ATTACK) > 0),
    hostileCreeps.filter(c => c.getActiveBodyparts(RANGED_ATTACK) > 0),
    hostileCreeps.filter(c =>
      c.getActiveBodyparts(ATTACK) === 0 && c.getActiveBodyparts(RANGED_ATTACK) === 0
    ),
    hostileStructures.filter(s =>
      s.structureType !== STRUCTURE_TOWER &&
      s.structureType !== STRUCTURE_SPAWN &&
      !TUNNEL_STRUCTURES.has(s.structureType)
    ),
    hostileStructures.filter(s => TUNNEL_STRUCTURES.has(s.structureType)),
  ];
}

// ── Tunneling ──

interface TunnelTarget {
  target: Attackable;
  path: RoomPosition[];
  cost: number;
}

function findBestTunnelTarget(creep: Creep, tier: Attackable[]): TunnelTarget | null {
  const costs = buildTunnelCostMatrix(creep.room);
  let best: TunnelTarget | null = null;

  for (const target of tier) {
    const result = PathFinder.search(creep.pos, { pos: target.pos, range: 1 }, {
      roomCallback: () => costs,
      maxOps: 4000,
      maxRooms: 1,
    });

    if (!result.incomplete && (!best || result.cost < best.cost)) {
      best = { target, path: result.path, cost: result.cost };
    }
  }

  return best;
}

function buildTunnelCostMatrix(room: Room): PathFinder.CostMatrix {
  const costs = new PathFinder.CostMatrix();
  const terrain = Game.map.getRoomTerrain(room.name);

  // Default: plain=1, swamp=5
  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) {
      const t = terrain.get(x, y);
      if (t === TERRAIN_MASK_WALL) costs.set(x, y, 254);
      else costs.set(x, y, t === TERRAIN_MASK_SWAMP ? 5 : 1);
    }
  }

  // Weight walls by health (higher health = higher cost = harder to tunnel)
  const walls = room.find(FIND_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_WALL
  });
  for (const w of walls) {
    costs.set(w.pos.x, w.pos.y, Math.min(254, Math.ceil(w.hits / 50000)));
  }

  // Weight ramparts by health × 0.95 (natural decay makes them slightly easier)
  const ramparts = room.find(FIND_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_RAMPART
  });
  for (const r of ramparts) {
    costs.set(r.pos.x, r.pos.y, Math.min(254, Math.ceil(r.hits * 0.95 / 50000)));
  }

  return costs;
}

function walkTunnelPath(creep: Creep, path: RoomPosition[]): void {
  // Attack any wall/rampart adjacent on the path
  const next = path[0];
  if (next && creep.pos.getRangeTo(next) <= 1) {
    const structures = creep.room.lookForAt(LOOK_STRUCTURES, next.x, next.y);
    const barrier = structures.find(s =>
      s.structureType === STRUCTURE_WALL || s.structureType === STRUCTURE_RAMPART
    );
    if (barrier) {
      creep.attack(barrier);
      return; // don't move this tick — let the attack land first
    }
  }
  // Move along path
  creep.moveByPath(path);
}

