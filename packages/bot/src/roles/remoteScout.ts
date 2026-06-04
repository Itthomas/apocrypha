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
  route?: Array<{ exit: ExitConstant; room: string }>;
  routeRoom?: string;
  lastRoom?: string;
}

export function run(creep: Creep): boolean {
  const mem = creep.memory as RemoteScoutMemory;
  mem.lastRoom = creep.room.name;

  // Not in target room → travel there
  if (creep.room.name !== mem.targetRoom) {
    travelToRoom(creep, mem.targetRoom);
    return true;
  }

  // In target room — gather data
  const rooms = (Memory.rooms[mem.sourceRoom] as any)?.remoteRooms;
  if (!rooms || !rooms[mem.targetRoom]) return false;

  const entry = rooms[mem.targetRoom];
  if (entry.phase !== 'scouting') return false;

  const controller = creep.room.controller;

  // No controller
  if (!controller) {
    entry.phase = 'noController';
    console.log(`[remoteScout] ${mem.targetRoom} has no controller`);
    return false;
  }

  // Occupied by someone else
  if (controller.owner || (controller.reservation && controller.reservation.username !== (Memory as any).username)) {
    entry.phase = 'occupied';
    console.log(`[remoteScout] ${mem.targetRoom} is occupied`);
    return false;
  }

  // Gather sources
  const sources = creep.room.find(FIND_SOURCES);
  if (sources.length < 2) {
    entry.phase = 'noController'; // not literally, but not worth harvesting
    console.log(`[remoteScout] ${mem.targetRoom} has <2 sources`);
    return false;
  }

  entry.sources = sources.map(s => ({ x: s.pos.x, y: s.pos.y }));

  // Compute joined-terrain road paths
  const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
  if (!spawn) return false;

  // Path to each source
  const sourcePaths: Array<Array<{ x: number; y: number; room: string }>> = [];
  for (const s of sources) {
    const result = PathFinder.search(spawn.pos, { pos: s.pos, range: 1 }, {
      maxRooms: 2,
      maxOps: 4000,
    });
    if (!result.incomplete) {
      sourcePaths.push(result.path.map(p => ({ x: p.x, y: p.y, room: p.roomName })));
    }
  }

  // Path to controller
  let controllerPath: Array<{ x: number; y: number; room: string }> | null = null;
  if (controller) {
    const ctrlResult = PathFinder.search(spawn.pos, { pos: controller.pos, range: 1 }, {
      maxRooms: 2,
      maxOps: 4000,
    });
    if (!ctrlResult.incomplete) {
      controllerPath = ctrlResult.path.map(p => ({ x: p.x, y: p.y, room: p.roomName }));
    }
  }

  entry.roadPath = { sources: sourcePaths };
  entry.controllerPath = controllerPath;
  entry.reserveTicks = 0;

  console.log(`[remoteScout] ${mem.targetRoom}: ${sources.length} sources, ${sourcePaths.length} paths computed`);
  return true;
}
