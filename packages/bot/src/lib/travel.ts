/**
 * lib/travel.ts — Shared inter-room travel helper
 *
 * Uses Game.map.findRoute to compute a room-level route, then navigates
 * exit-by-exit with maxRooms:1. This avoids the edge-case failures of
 * direct cross-room moveTo (non-existent exits, zombie paths, blinking).
 *
 * Hostile rooms are blacklisted in Memory.hostileRooms only when a creep
 * is actually killed there (not natural death). The main loop handles
 * marking via the creep's lastRoom field on death. Route planning
 * avoids blacklisted rooms for 10000 ticks.
 */

const HOSTILE_EXPIRY = 10000;

interface TravelMemory {
  targetRoom: string;
  lastRoom?: string;   // last room the creep was in (set each tick)
  route?: Array<{ exit: ExitConstant; room: string }>;
  routeRoom?: string;  // room where route was computed
}

/** Check whether a room name is currently blacklisted as hostile */
export function isHostile(roomName: string): boolean {
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

/** Check whether a room name refers to a hallway (x or y divisible by 10) */
function isHallway(roomName: string): boolean {
  const match = roomName.match(/^([WE])(\d+)([NS])(\d+)$/);
  if (!match) return false;
  const x = (match[1] === 'W' ? -1 : 1) * parseInt(match[2], 10);
  const y = (match[3] === 'N' ? 1 : -1) * parseInt(match[4], 10);
  return Math.abs(x) % 10 === 0 || Math.abs(y) % 10 === 0;
}

/**
 * Navigate a creep to a target room using exit-by-exit routing.
 * Returns true if movement was issued, false if no path exists.
 * @param skipHostileAvoid If true, don't filter out hostile or owned rooms (combat).
 * @param onlyRespawn If true, ONLY route through respawn area rooms.
 * @param onlyNovice If true, ONLY route through novice area rooms.
 */
export function travelToRoom(creep: Creep, targetRoom: string, skipHostileAvoid: boolean = false, onlyRespawn: boolean = false, onlyNovice: boolean = false): boolean {
  const mem = creep.memory as TravelMemory;

  // Track last room for death-based hostile detection
  mem.lastRoom = creep.room.name;

  // Already there
  if (creep.room.name === targetRoom) return false;

  // ── Edge override: move toward room center if on the boundary ──
  const pos = creep.pos;
  if (pos.x === 0 || pos.x === 49 || pos.y === 0 || pos.y === 49) {
    creep.moveTo(new RoomPosition(25, 25, creep.room.name), { maxRooms: 1 });
    return true;
  }

  // Invalidate route if we entered a room not matching the cached route head
  if (mem.route && mem.route.length > 0 && mem.routeRoom !== creep.room.name) {
    delete mem.route;
    delete mem.routeRoom;
  }

  // Compute or reuse route
  if (!mem.route || mem.route.length === 0) {
    const route = Game.map.findRoute(creep.room.name, targetRoom, {
      routeCallback(roomName) {
        // Respawn / novice zone filters
        const status = Game.map.getRoomStatus(roomName).status;

        // onlyRespawn mode: skip everything except respawn rooms and hallways
        if (onlyRespawn && status !== 'respawn' && !isHallway(roomName)) return Infinity;

        // onlyNovice mode: skip everything except novice rooms and hallways
        if (onlyNovice && status !== 'novice' && !isHallway(roomName)) return Infinity;

        // Default: skip respawn and novice zones (impassable boundary walls)
        if (!onlyRespawn && !onlyNovice && (status === 'respawn' || status === 'novice')) return Infinity;

        if (!skipHostileAvoid && isHostile(roomName)) return Infinity;
        if (!skipHostileAvoid && Game.rooms[roomName]) {
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
