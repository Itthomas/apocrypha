/**
 * roles/hauler.ts — Energy transport creep
 *
 * Two-state machine:
 *   GATHER:  locked onto a source container, withdraw until carry is full
 *   FILLING: locked onto a target structure, fill it until satisfied
 *
 * Transitions:
 *   GATHER → carry full → FILLING (highest-priority unsatisified target)
 *   FILLING → target filled (or was already full) →
 *     carry ≥50 → next unsatisified target
 *     carry <50 → GATHER
 *
 * Fill priority tiers (within each tier, nearest structure wins):
 *   spawn → extensions → tower → storage → spawn container → controller container
 */

enum HAULER_TASK {
  GATHER = 0,
  FILLING = 1,
}

interface HaulerMemory {
  role: 'hauler';
  task: HAULER_TASK;
  /** Locked target structure ID during FILLING */
  targetId?: Id<AnyStoreStructure>;
}

// ── Priority Tier Helpers ──

/**
 * A fill-priority tier: given a room, return every unsatisfied structure
 * of this tier's type. getNextFillTarget() picks the nearest one per tier.
 */
type FillTier = (room: Room, creep: Creep) => AnyStoreStructure[];

/** All spawns with free energy capacity */
function tierSpawns(room: Room, _creep: Creep): AnyStoreStructure[] {
  return room.find(FIND_MY_SPAWNS, {
    filter: s => s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
  });
}

/** All extensions with free energy capacity */
function tierExtensions(room: Room, _creep: Creep): AnyStoreStructure[] {
  return room.find(FIND_MY_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_EXTENSION && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
  });
}

/** All my towers below 90% energy */
function tierTowers(room: Room, _creep: Creep): AnyStoreStructure[] {
  return room.find(FIND_MY_STRUCTURES, {
    filter: s => {
      if (s.structureType !== STRUCTURE_TOWER) return false;
      return s.store.getUsedCapacity(RESOURCE_ENERGY) < s.store.getCapacity(RESOURCE_ENERGY) * 0.9;
    }
  });
}

/** Storage (if present) below 80% — sits between towers and containers */
function tierStorage(room: Room, _creep: Creep): AnyStoreStructure[] {
  return room.find(FIND_MY_STRUCTURES, {
    filter: s => {
      if (s.structureType !== STRUCTURE_STORAGE) return false;
      const st = s as StructureStorage;
      return st.store.getUsedCapacity(RESOURCE_ENERGY) < st.store.getCapacity(RESOURCE_ENERGY) * 0.8;
    }
  });
}

/** Containers within 3 tiles of any spawn, below 80% — overflow buffers */
function tierSpawnContainers(room: Room, creep: Creep): AnyStoreStructure[] {
  const spawns = room.find(FIND_MY_SPAWNS);
  if (spawns.length === 0) return [];

  const results: AnyStoreStructure[] = [];
  for (const spawn of spawns) {
    const nearby = spawn.pos.findInRange(FIND_STRUCTURES, 3, {
      filter: s => {
        if (s.structureType !== STRUCTURE_CONTAINER) return false;
        const store = (s as StructureContainer).store;
        return store.getUsedCapacity(RESOURCE_ENERGY) < store.getCapacity(RESOURCE_ENERGY) * 0.8;
      }
    });
    for (const c of nearby) results.push(c as AnyStoreStructure);
  }
  return results;
}

/** Container adjacent to the room controller, below 80% */
function tierControllerContainer(room: Room, _creep: Creep): AnyStoreStructure[] {
  if (!room.controller) return [];
  return room.controller.pos.findInRange(FIND_STRUCTURES, 1, {
    filter: s => {
      if (s.structureType !== STRUCTURE_CONTAINER) return false;
      const store = (s as StructureContainer).store;
      return store.getUsedCapacity(RESOURCE_ENERGY) < store.getCapacity(RESOURCE_ENERGY) * 0.8;
    }
  }) as AnyStoreStructure[];
}

/** Priority-ordered tiers. Checked top to bottom; first non-empty tier wins. */
const FILL_TIERS: FillTier[] = [
  tierSpawns,
  tierExtensions,
  tierTowers,
  tierStorage,
  tierSpawnContainers,
  tierControllerContainer,
];

/**
 * Walk priority tiers top-to-bottom. Within the first tier that has
 * any unsatisfied structures, return the one nearest to the creep.
 */
function getNextFillTarget(creep: Creep): AnyStoreStructure | null {
  const room = creep.room;

  for (const tier of FILL_TIERS) {
    const candidates = tier(room, creep);
    if (candidates.length > 0) {
      const nearest = creep.pos.findClosestByPath(candidates);
      if (nearest) return nearest;
    }
  }

  return null;
}

/**
 * Returns true when a fill target no longer needs energy.
 * Spawns/extensions/towers/storage: satisfied only when completely full.
 * Containers: satisfied at 80% — they act as passthrough buffers and
 *   get simultaneously drained by other haulers, so chasing 100% is futile.
 */
function isTargetSatisfied(target: AnyStoreStructure): boolean {
  if (target.store.getFreeCapacity(RESOURCE_ENERGY) <= 0) return true;
  if (target.structureType === STRUCTURE_CONTAINER) {
    const cap = target.store.getCapacity(RESOURCE_ENERGY);
    return target.store.getUsedCapacity(RESOURCE_ENERGY) >= cap * 0.8;
  }
  return false;
}

/** Find the nearest source container (adjacent to a source) with ≥100 energy */
function getSourceContainer(creep: Creep): StructureContainer | null {
  const sources = creep.room.find(FIND_SOURCES);
  const candidates: StructureContainer[] = [];

  for (const source of sources) {
    const containers = source.pos.findInRange(FIND_STRUCTURES, 1, {
      filter: s => s.structureType === STRUCTURE_CONTAINER && s.store.getUsedCapacity(RESOURCE_ENERGY) >= 100
    });
    for (const c of containers) candidates.push(c as StructureContainer);
  }

  if (candidates.length === 0) return null;
  return creep.pos.findClosestByPath(candidates) as StructureContainer | null;
}

// ── Main ──

export function run(creep: Creep): boolean {
  const mem = creep.memory as HaulerMemory;
  if (mem.task === undefined) mem.task = HAULER_TASK.GATHER;

  // GATHER: locked onto source container, fill carry
  if (mem.task === HAULER_TASK.GATHER) {
    // Transition: carry full → pick highest-priority fill target
    if (creep.store.getFreeCapacity() === 0) {
      const target = getNextFillTarget(creep);
      if (target) {
        mem.task = HAULER_TASK.FILLING;
        mem.targetId = target.id;
        return run(creep);
      }
      // No fill targets available — idle with full carry
      return false;
    }

    const source = getSourceContainer(creep);
    if (source) {
      if (creep.withdraw(source, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) creep.moveTo(source);
      return true;
    }
    // No source container with energy — wait
    return false;
  }

  // FILLING: locked onto a target structure
  if (mem.task === HAULER_TASK.FILLING) {
    // Validate our target still exists and is still unsatisfied
    const target = mem.targetId ? Game.getObjectById(mem.targetId) as AnyStoreStructure | null : null;
    if (!target || isTargetSatisfied(target)) {
      // Target is satisfied (filled or gone)
      if (creep.store.getUsedCapacity(RESOURCE_ENERGY) >= 50) {
        // Still have meaningful energy → next target
        const next = getNextFillTarget(creep);
        if (next) {
          mem.targetId = next.id;
          return run(creep);
        }
      }
      // Carry < 50 or no more targets → go gather
      mem.targetId = undefined;
      mem.task = HAULER_TASK.GATHER;
      return run(creep);
    }

    // Fill the target
    if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
      creep.moveTo(target);
    }
    return true;
  }

  return false;
}
