/**
 * roles/remoteScout.ts — Remote room scout
 *
 * Travels to an adjacent room, captures terrain and source data,
 * computes joined-terrain road paths from home spawn to each source
 * and to the controller. Stores everything in remoteRooms memory.
 * Detects occupied/noController rooms and updates phase accordingly.
 */

import { travelToRoom } from '../lib/travel';
import { updateReserveTicks } from '../remoteHarvesting';

interface RemoteScoutMemory {
  role: 'remoteScout';
  targetRoom: string;
  sourceRoom: string;
  arrived: boolean;
  route?: Array<{ exit: ExitConstant; room: string }>;
  routeRoom?: string;
  lastRoom?: string;
}

export function run(creep: Creep): boolean {
  const mem = creep.memory as RemoteScoutMemory;
  mem.lastRoom = creep.room.name;

  // ── Edge override: move toward room center if on the boundary ──
  const pos = creep.pos;
  if (pos.x === 0 || pos.x === 49 || pos.y === 0 || pos.y === 49) {
    creep.moveTo(new RoomPosition(25, 25, creep.room.name), { maxRooms: 1 });
    return true;
  }

  // Not in target room → travel there
  if (creep.room.name !== mem.targetRoom) {
    travelToRoom(creep, mem.targetRoom);
    return true;
  }

  // In target room — wait one tick for vision to stabilize, then gather data
  if (!mem.arrived) {
    mem.arrived = true;
    return true;
  }

  // Gather data
  const rooms = (Memory.rooms[mem.sourceRoom] as any)?.remoteRooms;
  if (!rooms || !rooms[mem.targetRoom]) return false;

  const entry = rooms[mem.targetRoom];
  if (!entry) return false;
  if (entry.phase !== 'scouting') return false;

  const controller = creep.room.controller;

  // No controller
  if (!controller) {
    entry.phase = 'noController';
    console.log(`[remoteScout] ${mem.targetRoom} has no controller`);
    return false;
  }

  // Occupied by someone else (not us)
  const myUsername = (Game.rooms[mem.sourceRoom]?.controller?.owner as any)?.username;
  const isOurs = controller.reservation?.username === myUsername;
  if (controller.owner || (controller.reservation && !isOurs)) {
    entry.phase = 'occupied';
    console.log(`[remoteScout] ${mem.targetRoom} is occupied`);
    return false;
  }

  // Gather sources
  const sources = creep.room.find(FIND_SOURCES);
  if (sources.length === 0) {
    entry.phase = 'noSources';
    console.log(`[remoteScout] ${mem.targetRoom} has no sources`);
    return false;
  }

  entry.sources = sources.map(s => ({ x: s.pos.x, y: s.pos.y }));

  // Compute joined-terrain road paths from home spawn
  const homeRoom = Game.rooms[mem.sourceRoom];
  const spawn = homeRoom?.find(FIND_MY_SPAWNS)[0];
  if (!spawn) return false;

  // Compute convergent road paths: controller first, then sources.
  // Each subsequent path treats previously-computed tiles as roads (cost 1).
  const roadTiles = new Set<string>(); // "roomName,x,y" keys

  // Path to controller first — becomes the trunk route
  if (controller) {
    const ctrlResult = PathFinder.search(spawn.pos, { pos: controller.pos, range: 1 }, {
      maxRooms: 2, maxOps: 4000,
    });
    if (!ctrlResult.incomplete) {
      const cPath = ctrlResult.path.map(p => ({ x: p.x, y: p.y, room: p.roomName }));
      entry.controllerPath = cPath;
      for (const t of cPath) roadTiles.add(`${t.room},${t.x},${t.y}`);
    }
  }

  // Source paths — each treats prior paths as roads
  const sourcePaths: Array<Array<{ x: number; y: number; room: string }>> = [];
  for (const s of sources) {
    const result = PathFinder.search(spawn.pos, { pos: s.pos, range: 1 }, {
      maxRooms: 2, maxOps: 4000,
      roomCallback: (roomName: string) => {
        const costs = new PathFinder.CostMatrix();
        const terrain = Game.map.getRoomTerrain(roomName);
        for (let x = 0; x < 50; x++) {
          for (let y = 0; y < 50; y++) {
            const t = terrain.get(x, y);
            if (t === TERRAIN_MASK_WALL) { costs.set(x, y, 255); continue; }
            // Prior computed paths are treated as roads (cost 1) — overrides everything
            if (roadTiles.has(`${roomName},${x},${y}`)) { costs.set(x, y, 1); continue; }
            costs.set(x, y, t === TERRAIN_MASK_SWAMP ? 5 : 1);
          }
        }
        // Treat existing roads as cost 1 so paths converge on real infrastructure
        const room = Game.rooms[roomName];
        if (room) {
          const roads = room.find(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_ROAD
          });
          for (const r of roads) costs.set(r.pos.x, r.pos.y, 1);
        }
        return costs;
      },
    });
    if (!result.incomplete) {
      const sPath = result.path.map(p => ({ x: p.x, y: p.y, room: p.roomName }));
      sourcePaths.push(sPath);
      for (const t of sPath) roadTiles.add(`${t.room},${t.x},${t.y}`);
    }
  }

  entry.roadPath = { sources: sourcePaths };
  entry.controllerPath = entry.controllerPath || null;
  entry.reserveTicks = 0;

  console.log(`[remoteScout] ${mem.targetRoom}: ${sources.length} sources, ${sourcePaths.length} paths computed`);
  return true;
}
