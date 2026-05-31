# Colonization Protocol — Implementation Plan

## Architecture Overview

```
main.ts (global tick)
  ├── runColonization()        ← new: global trigger + deadline mgmt
  │     checks GCL > ownedRooms && any RCL 5+
  │     creates Memory.colonization on trigger
  │     evaluates deadline expiry → picks bestRoom → triggers claimer
  │     enforces cooldown
  │
  ├── spawnManager.ts          ← modified: scout spawning
  │     reads colonization memory
  │     spawns 8 scouts per room (one per bearing)
  │     respawns dead scouts up to 5× per bearing
  │
  └── roles/scout.ts           ← new: scout behavior
        room scoring on entry
        bearing-priority maze routing
        single prevRoom backtrack escape
```

---

## Memory Structure

```typescript
// Memory.colonization
interface ColonizationMemory {
  active: boolean;                          // a wave is in progress
  deadline: number;                         // tick when scouting window closes
  cooldownUntil: number;                    // don't start new wave before this tick
  roomsVisited: string[];                   // every unique room any scout entered
  candidates: Record<string, RoomScore>;    // roomName → score
  bestRoom: {                               // best candidate so far
    name: string;                           // e.g. "W4N6"
    score: number;
    worldX: number;                         // world coords of ideal spawn pos
    worldY: number;
  } | null;
  nextBearing: number;                      // 0-7, rotates per scout spawned
  scoutState: Record<string, {              // key: "roomName_bearing"
    bearing: number;                        // 0=45° N interval
    respawns: number;                       // 0–5
  }>;
}

interface RoomScore {
  name: string;
  score: number;
  sources: number;
  worldX: number;           // ideal spawn world coords
  worldY: number;
  travelCosts: {            // from spawn to each POI (swamp-aware)
    sources: number[];      // one per source
    mineral: number;
    controller: number;
  };
}
```

### ScoutMemory (per creep)

```typescript
interface ScoutMemory {
  role: 'scout';
  bearing: number;      // 0..315 in 45° steps (N, NE, E, SE, S, SW, W, NW)
  temperature: number;  // 0..1 randomness offset, increases on respawn
  prevRoom: string;     // room we entered FROM (single-name backtrack)
  respawns: number;     // 0–5
  sourceRoom: string;   // room that spawned this scout
}
```

---

## Phase 1 — Global Trigger & Deadline Creation

**File:** new `packages/bot/src/colonization.ts`
**Called from:** `main.ts` every tick

```typescript
export function runColonization(): void {
  // Cooldown active → skip
  const col = Memory.colonization;
  if (col?.cooldownUntil && Game.time < col.cooldownUntil) return;

  // Already in a wave → check deadline expiry
  if (col?.active) {
    if (Game.time >= col.deadline) finishWave(col);
    return;
  }

  // Trigger conditions
  const ownedRooms = _.size(Game.rooms);  // or count rooms with my controller
  if (ownedRooms >= Game.gcl.level) return;

  const hasRcl5 = Object.values(Game.rooms).some(
    r => r.controller?.my && (r.controller.level ?? 0) >= 5
  );
  if (!hasRcl5) return;

  // Start new colonization wave
  Memory.colonization = {
    active: true,
    deadline: Game.time + 3000,
    cooldownUntil: 0,
    roomsVisited: [],
    candidates: {},
    bestRoom: null,
    nextBearing: 0,
    scoutState: {},
  };
}
```

**Deadline expiry:**

```typescript
function finishWave(col: ColonizationMemory): void {
  col.active = false;

  if (!col.bestRoom) {
    col.cooldownUntil = Game.time + 10000;
    return;
  }

  // Score threshold: 2 sources minimum + blueprint fits
  const best = col.candidates[col.bestRoom.name];
  if (!best || best.sources < 2) {
    col.cooldownUntil = Game.time + 10000;
    return;
  }

  // bestRoom is valid — claimer phase starts
  // (deferred to future implementation)
  col.cooldownUntil = Game.time + 10000; // temporary until claimer implemented
}
```

---

## Phase 2 — Scout Spawning

**File:** modified `spawnManager.ts`

### Quota

At RCL 5+, when `Memory.colonization.active && Game.time < Memory.colonization.deadline`:

- 8 scouts spawned per eligible room (one per bearing: 0, 1, 2, 3, 4, 5, 6, 7)
- Body: `[MOVE]` (50e)
- Scout quota: not part of regular role quotas — handled as a special case

### Spawning logic (per room, per tick)

```typescript
function trySpawnScout(room: Room, spawn: StructureSpawn): boolean {
  const col = Memory.colonization;
  if (!col?.active || Game.time >= col.deadline) return false;

  const BEARINGS = [0, 1, 2, 3, 4, 5, 6, 7]; // N, NE, E, SE, S, SW, W, NW

  for (const bearing of BEARINGS) {
    const key = `${room.name}_${bearing}`;
    const state = col.scoutState[key];

    // Already spawned and not dead → skip
    const alive = room.find(FIND_MY_CREEPS).some(
      c => c.memory.role === 'scout' && c.memory.bearing === bearing
    );
    if (alive) continue;

    // Check respawn budget
    const respawns = state?.respawns ?? 0;
    if (respawns >= 5 && state !== undefined) continue;

    // Spawn or respawn
    if (spawn.spawnCreep([MOVE], `scout_${Game.time}`, {
      memory: {
        role: 'scout',
        bearing,
        temperature: 0.1 * respawns,           // increases each respawn
        prevRoom: '',
        respawns: respawns + 1,
        sourceRoom: room.name,
      }
    }) === OK) {
      col.scoutState[key] = { bearing, respawns: respawns + 1 };
      return true; // one per tick
    }
  }

  return false;
}
```

**Spawn cooldown bypass:** Scouts are cheap (50e). Skip the spawn cooldown system for them.

**Death handling:** When a scout with `bearing=X` dies, its entry in `col.scoutState[roomName_X]` stays. Next tick, `trySpawnScout` sees no alive scout for that bearing and respawns it (if respawns < 5 and deadline hasn't passed).

---

## Phase 3 — Scout Behavior

**File:** new `packages/bot/src/roles/scout.ts`

### Per-tick logic

```
run(creep):
  1. New room? → scoreRoom(), add to candidates, update bestRoom
  2. Get exits for current room
  3. Filter exits: don't go back to prevRoom (unless it's the only option)
  4. Score filtered exits by bearing closeness + temperature
  5. Pick best exit, move toward it
  6. When crossing boundary → set prevRoom = old room name
```

### Bearing mapping

```typescript
const BEARING_TO_DIR: Record<number, ExitConstant[]> = {
  0: [FIND_EXIT_TOP],                        // N
  1: [FIND_EXIT_TOP, FIND_EXIT_RIGHT],      // NE
  2: [FIND_EXIT_RIGHT],                      // E
  3: [FIND_EXIT_RIGHT, FIND_EXIT_BOTTOM],   // SE
  4: [FIND_EXIT_BOTTOM],                     // S
  5: [FIND_EXIT_BOTTOM, FIND_EXIT_LEFT],    // SW
  6: [FIND_EXIT_LEFT],                       // W
  7: [FIND_EXIT_LEFT, FIND_EXIT_TOP],       // NW
};
```

### Exit scoring (per exit)

```typescript
function exitScore(exitDir: string, bearing: number, temp: number): number {
  const exitDeg = EXIT_TO_DEG[exitDir];  // N=0, NE=45, E=90...
  let score = 180 - Math.abs(bearing * 45 - exitDeg);
  score += temp * 180 * Math.random(); // temperature perturbation
  return score;
}
```

### Direction locking (replaces trail)

When a scout enters a new room, set `prevRoom`. This is the ONLY room filtered:

```
forwardExits = exits.filter(e => e.name !== prevRoom)
if forwardExits.length > 0 → pick best from forward
else → only option is prevRoom → backtrack (allowed)
```

No ping-pong bug: when returning to previous room, `prevRoom` becomes the room we just left, so the forward filter now EXCLUDES that room, forcing exploration of the other exit.

### Movement to exit

```typescript
function moveToExit(creep: Creep, exitDir: ExitConstant): void {
  const tiles = creep.room.find(exitDir);
  if (tiles.length > 0) {
    creep.moveTo(tiles[0], { reusePath: 10, maxRooms: 1 });
  }
}
```

---

## Phase 4 — Room Scoring

**File:** new `packages/bot/src/colonization/scoring.ts`

### Blueprint fit check

For each room being scored, find the best spawn position:

1. Candidate spawn positions: every non-wall tile in the room
2. For each candidate: check if all blueprint structures (all RCLs) fit without hitting walls
   - Blueprint provides spawn-relative offsets: `(spawnX + offsetX, spawnY + offsetY)`
   - If any blueprint position is on a wall → candidate fails
3. Pick the candidate with the best fit (most structures fit, or all fit)

**Optimization:** Only check every 3rd tile (step 3) as an anchor, then fine-tune the best area. Or start from room center and expand outward, stopping at first valid position.

### Travel cost (swamp-aware)

For a given spawn position, compute weighted travel cost to each point of interest:

```
cost(source) = pathLength(source) + swampPenalty(source)
  where swampPenalty = count of swamp tiles in path × SWAMP_COST (4 extra fatigue)
```

Use `PathFinder.search` with swamp cost weighting for accurate results, but only once per candidate spawn position.

### Score formula

```
score = sources × 1000                              // each source = +1000
      - totalTravelCost × 10                        // distance penalty
      + (controllerProximity < 5 ? 200 : 0)        // bonus if controller very close
```

Hard gates:
- `< 2 sources` → score = -1 (invalid)
- blueprint doesn't fit anywhere → score = -1
- room has hostile structures → score /= 2  (soft penalty)

---

## Metrics Tracking

Add to telemetry stats (in colonization wave):
```typescript
colonyStats: {
  roomsScouted: number;
  roomsEvaluated: number;
  bestScore: number;
  bestRoom: string | null;
  scoutsAlive: number;
  scoutsTotalSpawned: number;
}
```

---

## Summary

| Component | File | Status |
|---|---|---|
| Global trigger + deadline | `colonization.ts` | New |
| Memory structure | Memory typing | New |
| Scout spawning | `spawnManager.ts` | Modified |
| Scout behavior | `roles/scout.ts` | New |
| Room scoring | `colonization/scoring.ts` | New (deferred detail) |
| Claimer phase | — | Deferred |
| Telemetry | `telemetry/` | Modified |

---

## Edge Cases Covered

- **No exits in bearing direction:** bearing-priority + temperature divergence means a different exit is always chosen after filtering
- **Dead-end room:** forwardExits empty → `prevRoom` backtrack allowed
- **Scout dies mid-crossing:** respawn logic picks up same bearing, higher temperature, different initial path
- **Wave expires with no valid candidates:** cooldown for 10k ticks, retry
- **GCL increases during wave:** fine — checked on next wave trigger
- **Room loses RCL 5 during wave:** scouts from that room stop spawning (quota condition fails)
- **Multiple RCL 5+ rooms:** each spawns its own 8 scouts, candidates shared in `Memory.colonization.candidates`
