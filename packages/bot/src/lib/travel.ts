/**
 * lib/travel.ts — Shared inter-room travel helper
 *
 * Uses Game.map.findRoute to compute a room-level route, then navigates
 * exit-by-exit with maxRooms:1. This avoids the edge-case failures of
 * direct cross-room moveTo (non-existent exits, zombie paths, blinking).
 *
 * Hostile rooms (where creeps get killed) are blacklisted in
 * Memory.hostileRooms with a timestamp. Route planning avoids them
 * for 10000 ticks. Rooms are marked hostile when a creep is in a room
 * with enemy creeps or structures.
 *
 * The route is cached in creep.memory.route / .routeRoom and invalidated
 * when the creep enters a new room that doesn't match the cached route head.
 */

const HOSTILE_EXPIRY = 10000;

interface TravelMemory {
  targetRoom: string;
  route?: Array<{ exit: ExitConstant; room: string }>;
  routeRoom?: string;  // room where route was computed
}

/** Check whether a room name is currently blacklisted as hostile */
function isHostile(roomName: string): boolean {
  const hostileRooms = Memory.hostileRooms as Record<string, number> | undefined;
  if (!hostileRooms) return false;
  const ts = hostileRooms[roomName];
  if (!ts) return false;
  if (Game.time - ts > HOSTILE_EXPIRY) {
    delete hostileRooms[roomName];
    return false;
  }
  return true;
}

/** Mark the creep's current room as hostile if enemies are present */
function markHostileIfNeeded(creep: Creep): void {
  const roomName = creep.room.name;
  const hostiles = creep.room.find(FIND_HOSTILE_CREEPS);
  if (hostiles.length === 0) {
    const structures = creep.room.find(FIND_HOSTILE_STRUCTURES);
    if (structures.length === 0) return;
  }
  if (!Memory.hostileRooms) Memory.hostileRooms = {};
  (Memory.hostileRooms as Record<string, number>)[roomName] = Game.time;
}

/**
 * Navigate a creep to a target room using exit-by-exit routing.
 * Returns true if movement was issued, false if no path exists.
 */
export function travelToRoom(creep: Creep, targetRoom: string): boolean {
  const mem = creep.memory as TravelMemory;

  // Already there
  if (creep.room.name === targetRoom) return false;

  // Check for hostiles in current room
  markHostileIfNeeded(creep);

  // Invalidate route if we entered a room not matching the cached route head
  if (mem.route && mem.route.length > 0 && mem.routeRoom !== creep.room.name) {
    delete mem.route;
    delete mem.routeRoom;
  }

  // Compute or reuse route
  if (!mem.route || mem.route.length === 0) {
    const route = Game.map.findRoute(creep.room, targetRoom, {
      routeCallback(roomName) {
        // Avoid rooms known to be hostile
        if (isHostile(roomName)) return Infinity;
        // Avoid rooms owned by others on live servers
        if (Game.rooms[roomName]) {
          const ctrl = Game.rooms[roomName].controller;
          if (ctrl && ctrl.owner && !ctrl.my) return Infinity;
        }
        return 1;
      }
    });
    if (route === ERR_NO_PATH) return false;

    mem.route = route;
    mem.routeRoom = creep.room.name;
  }

  // Navigate to the next exit
  const next = mem.route[0];
  const exit = creep.pos.findClosestByPath(next.exit);
  if (exit) {
    creep.moveTo(exit, { maxRooms: 1 });
  }

  return true;
}
