/**
 * roles/remoteWorker.ts — Remote harvesting worker
 *
 * Cycles between home and a remote room. In the remote room:
 *   - Ensures containers exist near sources (places sites if missing)
 *   - Ensures roads exist along the precomputed path
 *   - Harvests from sources until carry is full
 *   - Repairs its container when source is depleted
 *   - Repairs roads as it walks them
 * Then returns home to transfer energy to storage/spawn.
 *
 * Body: 1:3:2 work:carry:move — built for speed over toughness.
 */

import { travelToRoom } from '../lib/travel';

interface RemoteWorkerMemory {
  role: 'remoteWorker';
  targetRoom: string;
  sourceRoom: string;
  phase: 'going' | 'harvesting' | 'returning';
  sourceId?: Id<Source>;
  route?: Array<{ exit: ExitConstant; room: string }>;
  routeRoom?: string;
  lastRoom?: string;
}

export function run(creep: Creep): boolean {
  const mem = creep.memory as RemoteWorkerMemory;
  mem.lastRoom = creep.room.name;

  if (mem.phase === undefined) mem.phase = 'going';

  // ── Going: travel to remote room ──
  if (mem.phase === 'going') {
    if (creep.room.name !== mem.targetRoom) {
      travelToRoom(creep, mem.targetRoom);
      repairRoadIfNeeded(creep);
      return true;
    }
    mem.phase = 'harvesting';
  }

  // ── Returning: travel home ──
  if (mem.phase === 'returning') {
    if (creep.room.name !== mem.sourceRoom) {
      travelToRoom(creep, mem.sourceRoom);
      repairRoadIfNeeded(creep);
      return true;
    }
    // Transfer energy to storage or spawn
    if (creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
      const storage = creep.room.storage;
      if (storage && storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        if (creep.transfer(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) creep.moveTo(storage);
        return true;
      }
      const spawn = creep.pos.findClosestByPath(FIND_MY_SPAWNS, {
        filter: s => (s as StructureSpawn).store.getFreeCapacity(RESOURCE_ENERGY) > 0
      });
      if (spawn) {
        if (creep.transfer(spawn, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) creep.moveTo(spawn);
        return true;
      }
    }
    mem.phase = 'going';
    return true;
  }

  // ── Harvesting: in remote room ──
  // Ensure infrastructure exists
  ensureRemoteInfrastructure(creep, mem);

  // Harvest from source
  if (!mem.sourceId || !Game.getObjectById(mem.sourceId)) {
    const sources = creep.room.find(FIND_SOURCES_ACTIVE);
    if (sources.length > 0) mem.sourceId = sources[0].id;
    else mem.sourceId = creep.room.find(FIND_SOURCES)[0]?.id;
  }

  const source = mem.sourceId ? Game.getObjectById(mem.sourceId) : null;
  if (source) {
    // Repair container when source is depleted
    if (source.energy === 0) {
      const container = source.pos.findInRange(FIND_STRUCTURES, 1, {
        filter: s => s.structureType === STRUCTURE_CONTAINER
      })[0];
      if (container && container.hits < container.hitsMax) {
        creep.repair(container);
        return true;
      }
    }

    // Harvest if carry has space
    if (creep.store.getFreeCapacity() > 0 && source.energy > 0) {
      if (creep.harvest(source) === ERR_NOT_IN_RANGE) creep.moveTo(source);
      return true;
    }
  }

  // Carry full → head home
  mem.phase = 'returning';
  return true;
}

// ── Infrastructure ──

function ensureRemoteInfrastructure(creep: Creep, mem: RemoteWorkerMemory): void {
  const rooms = (Memory.rooms[mem.sourceRoom] as any)?.remoteRooms;
  if (!rooms || !rooms[mem.targetRoom]) return;
  const entry = rooms[mem.targetRoom];

  // Place containers near each source
  const sources = creep.room.find(FIND_SOURCES);
  for (const s of sources) {
    const containers = s.pos.findInRange(FIND_STRUCTURES, 1, {
      filter: st => st.structureType === STRUCTURE_CONTAINER
    });
    if (containers.length === 0) {
      // Place container at closest adjacent non-wall tile
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue;
          const tx = s.pos.x + dx, ty = s.pos.y + dy;
          if (tx < 0 || tx > 49 || ty < 0 || ty > 49) continue;
          if (creep.room.getTerrain().get(tx, ty) === TERRAIN_MASK_WALL) continue;
          const existing = creep.room.lookForAt(LOOK_CONSTRUCTION_SITES, tx, ty);
          if (existing.length > 0) continue;
          if (creep.room.createConstructionSite(tx, ty, STRUCTURE_CONTAINER) === OK) return;
        }
      }
    }
  }

  // Build any existing sites
  const site = creep.pos.findClosestByPath(FIND_CONSTRUCTION_SITES);
  if (site) {
    if (creep.build(site) === ERR_NOT_IN_RANGE) creep.moveTo(site);
    return;
  }

  // Place roads along precomputed paths
  if (entry.roadPath?.sources) {
    for (const path of entry.roadPath.sources) {
      for (const tile of path) {
        if (tile.room !== creep.room.name) continue;
        const existing = creep.room.lookForAt(LOOK_STRUCTURES, tile.x, tile.y)
          .concat(creep.room.lookForAt(LOOK_CONSTRUCTION_SITES, tile.x, tile.y) as any[]);
        const hasRoad = existing.some((s: any) =>
          s.structureType === STRUCTURE_ROAD
        );
        if (!hasRoad) {
          if (creep.room.createConstructionSite(tile.x, tile.y, STRUCTURE_ROAD) === OK) return;
        }
      }
    }
  }
}

/** Repair the road under the creep if damaged */
function repairRoadIfNeeded(creep: Creep): void {
  const roads = creep.room.lookForAt(LOOK_STRUCTURES, creep.pos.x, creep.pos.y)
    .filter(s => s.structureType === STRUCTURE_ROAD) as StructureRoad[];
  for (const road of roads) {
    if (road.hits < road.hitsMax * 0.5) {
      creep.repair(road);
      break;
    }
  }
}
