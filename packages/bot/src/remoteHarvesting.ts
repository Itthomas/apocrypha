/**
 * remoteHarvesting.ts — Remote room harvesting orchestrator
 *
 * Triggers at RCL 5+. Initializes remoteRooms for each adjacent
 * exit-accessible room. Phases: scouting → harvesting, occupied, noController.
 *
 * scouting:     remoteScout gathers terrain + source data, computes road paths
 * harvesting:   reserver maintains reservation, remoteWorkers haul energy home
 * occupied:     controller is owned/reserved by someone else — skipped
 * noController: no controller present (highway, SK room) — can't harvest
 */

const REMOTE_RESERVE_THRESHOLD = 4000;

// ── Room name helpers ──

function parseRoomXY(name: string): [number, number] {
  const match = name.match(/^([WE])(\d+)([NS])(\d+)$/);
  if (!match) return [0, 0];
  const x = (match[1] === 'W' ? -1 : 1) * parseInt(match[2], 10);
  const y = (match[3] === 'N' ? 1 : -1) * parseInt(match[4], 10);
  return [x, y];
}

// ── Public API ──

export function runRemoteHarvesting(): void {
  for (const _rn in Game.rooms) {
    const room = Game.rooms[_rn];
    if (!room.controller?.my) continue;
    if ((room.controller?.level ?? 0) < 5) continue;

    const rcl = room.controller!.level;

    // Initialize remoteRooms on first trigger
    if (!Memory.rooms[room.name]) (Memory.rooms[room.name] as any) = {};
    if (!(Memory.rooms[room.name] as any).remoteRooms) {
      initRemoteRooms(room);
    }

    // Process each remote room phase
    const remoteRooms = (Memory.rooms[room.name] as any).remoteRooms as Record<string, any>;
    for (const remoteName of Object.keys(remoteRooms)) {
      const entry = remoteRooms[remoteName];
      if (!entry) continue;

      // Check if phase needs to change
      if (entry.phase === 'scouting' && entry.sources && entry.sources.length >= 2 && entry.roadPath) {
        entry.phase = 'harvesting';
        console.log(`[remote] ${remoteName} scouting complete — harvesting begins`);
      }
    }
  }
}

function initRemoteRooms(room: Room): void {
  const exits = Game.map.describeExits(room.name);
  if (!exits) return;

  const remoteRooms: Record<string, any> = {};
  for (const _dir in exits) {
    const adjRoom = exits[_dir];
    remoteRooms[adjRoom] = { phase: 'scouting', sources: [], roadPath: null, controllerPath: null };
  }

  (Memory.rooms[room.name] as any).remoteRooms = remoteRooms;
  console.log(`[remote] ${room.name} initialized ${Object.keys(remoteRooms).length} adjacent rooms`);
}

// ── Helpers for callers ──

/** Get all remote room entries for a home room */
export function getRemoteRooms(homeRoom: string): Record<string, any> | null {
  return (Memory.rooms[homeRoom] as any)?.remoteRooms || null;
}

/** Check if a reserver is needed for a remote room */
export function reserverNeeded(homeRoom: string, remoteRoom: string): boolean {
  const rooms = getRemoteRooms(homeRoom);
  if (!rooms) return false;
  const entry = rooms[remoteRoom];
  if (!entry || entry.phase !== 'harvesting') return false;

  // Already have a reserver?
  if (entry.reservationId && Game.creeps[entry.reservationId]) return false;

  // Check reservation level (stored estimate)
  const reserveTicks = entry.reserveTicks ?? 0;
  return reserveTicks < REMOTE_RESERVE_THRESHOLD;
}

/** Check if a remoteWorker is needed for a remote room */
export function remoteWorkerNeeded(homeRoom: string, remoteRoom: string): boolean {
  const rooms = getRemoteRooms(homeRoom);
  if (!rooms) return false;
  const entry = rooms[remoteRoom];
  return entry?.phase === 'harvesting';
}

/** Store reservation tick estimate for a remote room */
export function updateReserveTicks(homeRoom: string, remoteRoom: string, ticks: number): void {
  const rooms = getRemoteRooms(homeRoom);
  if (!rooms || !rooms[remoteRoom]) return;
  rooms[remoteRoom].reserveTicks = ticks;
}

/** Get the number of remote workers currently alive for a room */
export function countRemoteWorkers(homeRoom: string, remoteRoom: string): number {
  let count = 0;
  for (const name in Game.creeps) {
    const c = Game.creeps[name];
    if (c.memory.role === 'remoteWorker' &&
        (c.memory as any).targetRoom === remoteRoom &&
        (c.memory as any).sourceRoom === homeRoom) count++;
  }
  return count;
}
