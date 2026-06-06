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
  lastRoom?: string;
  /** Tick the creep entered its current room (set by travelToRoom).
   * Used by the death handler to only blacklist rooms where the creep
   * was killed shortly after entering (ambush at the border). */
  enteredRoomTick?: number;
  route?: Array<{ exit: ExitConstant; room: string }>;
  routeRoom?: string;
  zoneMode?: 'respawn' | 'novice' | null;  // sticky: persists through hallways
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
export function isHallway(roomName: string): boolean {
  const match = roomName.match(/^([WE])(\d+)([NS])(\d+)$/);
  if (!match) return false;
  const x = (match[1] === 'W' ? -1 : 1) * parseInt(match[2], 10);
  const y = (match[3] === 'N' ? 1 : -1) * parseInt(match[4], 10);
  return Math.abs(x) % 10 === 0 || Math.abs(y) % 10 === 0;
}

/** Check whether a room is a sector center — the 9 rooms around (x%10≈5, y%10≈5)
 * where NPC bots (Source Keepers, Invaders) spawn. These are dangerous transit
 * rooms that scouts and haulers should route around when possible. */
export function isSectorCenter(roomName: string): boolean {
  const match = roomName.match(/^([WE])(\d+)([NS])(\d+)$/);
  if (!match) return false;
  const x = (match[1] === 'W' ? -1 : 1) * parseInt(match[2], 10);
  const y = (match[3] === 'N' ? 1 : -1) * parseInt(match[4], 10);
  const ax = Math.abs(x), ay = Math.abs(y);
  // Highways are not sector centers
  if (ax % 10 === 0 || ay % 10 === 0) return false;
  const rx = ax % 10, ry = ay % 10;
  return rx >= 4 && rx <= 6 && ry >= 4 && ry <= 6;
}

/**
 * Navigate a creep to a target room using exit-by-exit routing.
 * Returns true if movement was issued, false if no path exists.
 *
 * Automatically detects the current room's zone status and routes
 * accordingly: respawn rooms only route through respawn+hallways,
 * novice rooms only through novice+hallways, normal rooms skip both.
 *
 * @param skipHostileAvoid If true, don't filter out hostile or owned rooms (combat).
 * @param avoidCenter If true, try to route around sector center rooms where
 *   NPC bots spawn. Falls back to routing through centers if no other path exists.
 */
export function travelToRoom(creep: Creep, targetRoom: string, skipHostileAvoid: boolean = false, avoidCenter: boolean = false): boolean {
  const mem = creep.memory as TravelMemory;

  // Track room entry for hostile detection: only blacklist rooms where a
  // creep was killed shortly after entering (ambush), not after a long stay.
  if (mem.lastRoom !== creep.room.name) {
    mem.enteredRoomTick = Game.time;
  }
  mem.lastRoom = creep.room.name;

  // Already there
  if (creep.room.name === targetRoom) return false;

  // ── Edge override: move toward room center if on the boundary ──
  const pos = creep.pos;
  if (pos.x === 0 || pos.x === 49 || pos.y === 0 || pos.y === 49) {
    creep.moveTo(new RoomPosition(25, 25, creep.room.name), { maxRooms: 1 });
    return true;
  }

  // Detect zone mode from the creep's current room (sticky through hallways)
  const roomStatus = Game.map.getRoomStatus(creep.room.name).status;
  if (roomStatus === 'respawn' || roomStatus === 'novice') {
    mem.zoneMode = roomStatus;
  } else if (!isHallway(creep.room.name)) {
    mem.zoneMode = null; // left the zone entirely — back to normal routing
  }
  // In a hallway: keep existing zoneMode (set from the zone we entered through)
  const restrictTo = mem.zoneMode || null;

  // Invalidate route if we entered a room not matching the cached route head
  if (mem.route && mem.route.length > 0 && mem.routeRoom !== creep.room.name) {
    delete mem.route;
    delete mem.routeRoom;
  }

  // Compute or reuse route
  if (!mem.route || mem.route.length === 0) {
    const makeRouteCallback = (blockCenters: boolean) => {
      return (roomName: string) => {
        const status = Game.map.getRoomStatus(roomName).status;

        // In a respawn or novice zone: only route through matching rooms + hallways
        if (restrictTo && status !== restrictTo && !isHallway(roomName)) return Infinity;

        // In a normal room: skip respawn and novice zones
        if (!restrictTo && (status === 'respawn' || status === 'novice')) return Infinity;

        if (!skipHostileAvoid && isHostile(roomName)) return Infinity;
        if (blockCenters && isSectorCenter(roomName)) return Infinity;
        if (!skipHostileAvoid && Game.rooms[roomName]) {
          const ctrl = Game.rooms[roomName].controller;
          if (ctrl && ctrl.owner && !ctrl.my) return Infinity;
        }
        return 1;
      };
    };

    let route = Game.map.findRoute(creep.room.name, targetRoom, {
      routeCallback: makeRouteCallback(avoidCenter)
    });

    // If center avoidance blocked all paths, fall back to routing through centers
    if (route === ERR_NO_PATH && avoidCenter) {
      route = Game.map.findRoute(creep.room.name, targetRoom, {
        routeCallback: makeRouteCallback(false)
      });
    }

    if (route === ERR_NO_PATH) return false;

    mem.route = route;
    mem.routeRoom = creep.room.name;
  }

  // Navigate to the next exit. If the room has hostiles with ATTACK or
  // RANGED_ATTACK parts, overlay a danger CostMatrix to route around them.
  // Cost gradient: 50 within attack range (1-4), 20 in buffer zone (5-6).
  // Re-evaluated every tick — hostiles move, so no caching.
  const next = mem.route[0];
  const exit = creep.pos.findClosestByPath(next.exit);
  if (exit) {
    const hostiles = creep.room.find(FIND_HOSTILE_CREEPS, {
      filter: c => c.getActiveBodyparts(ATTACK) > 0 || c.getActiveBodyparts(RANGED_ATTACK) > 0
    });
    if (hostiles.length > 0) {
      const opts: any = { maxRooms: 1 };
      opts.costCallback = function(_roomName: string, costs: PathFinder.CostMatrix): PathFinder.CostMatrix {
        for (const hostile of hostiles) {
          const hx = hostile.pos.x, hy = hostile.pos.y;
          for (let dx = -6; dx <= 6; dx++) {
            for (let dy = -6; dy <= 6; dy++) {
              const x = hx + dx, y = hy + dy;
              if (x < 0 || x > 49 || y < 0 || y > 49) continue;
              const dist = Math.max(Math.abs(dx), Math.abs(dy));
              if (dist === 0) continue;
              const existing = costs.get(x, y);
              if (existing >= 255) continue; // walls stay walls
              if (dist <= 4 && existing < 50) costs.set(x, y, 50);
              else if (dist <= 6 && existing < 20) costs.set(x, y, 20);
            }
          }
        }
        return costs;
      };
      creep.moveTo(exit, opts);
    } else {
      creep.moveTo(exit, { maxRooms: 1 });
    }
  }

  return true;
}
