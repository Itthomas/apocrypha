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
 * Fill priority: spawn → extensions → tower → overflow container → controller container
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

const FILL_PRIORITY: StructureConstant[] = [
  STRUCTURE_SPAWN,
  STRUCTURE_EXTENSION,
  STRUCTURE_TOWER,
  STRUCTURE_CONTAINER, // overflow, then controller — determined by position context
];

/** Returns the highest-priority structure that isn't satisfied (has free capacity) */
function getNextFillTarget(creep: Creep): AnyStoreStructure | null {
  const room = creep.room;

  // 1. Spawn
  const spawn = room.find(FIND_MY_SPAWNS, {
    filter: s => s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
  })[0];
  if (spawn) return spawn;

  // 2. Extensions
  const ext = room.find(FIND_MY_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_EXTENSION && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
  })[0];
  if (ext) return ext;

  // 3. Tower
  const tower = room.find(FIND_MY_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_TOWER && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
  })[0];
  if (tower) return tower;

  // 4. Spawn overflow container (within 3 tiles of spawn, below 80%)
  const spawns = room.find(FIND_MY_SPAWNS);
  if (spawns.length > 0) {
    const overflow = spawns[0].pos.findInRange(FIND_STRUCTURES, 3, {
      filter: s => {
        if (s.structureType !== STRUCTURE_CONTAINER) return false;
        const store = (s as StructureContainer).store;
        return store.getFreeCapacity(RESOURCE_ENERGY) > store.getCapacity(RESOURCE_ENERGY) * 0.2;
      }
    })[0];
    if (overflow) return overflow as AnyStoreStructure;
  }

  // 5. Controller container (below 80%)
  const controller = room.controller;
  if (controller) {
    const ct = controller.pos.findInRange(FIND_STRUCTURES, 1, {
      filter: s => {
        if (s.structureType !== STRUCTURE_CONTAINER) return false;
        const store = (s as StructureContainer).store;
        return store.getFreeCapacity(RESOURCE_ENERGY) > store.getCapacity(RESOURCE_ENERGY) * 0.2;
      }
    })[0];
    if (ct) return ct as AnyStoreStructure;
  }

  return null;
}

/** Returns true if a fill target is considered satisfied */
function isTargetSatisfied(target: AnyStoreStructure): boolean {
  const free = target.store.getFreeCapacity(RESOURCE_ENERGY);
  if (free <= 0) return true;
  // Containers are satisfied at 80% — they get drained simultaneously
  if (target.structureType === STRUCTURE_CONTAINER) {
    const cap = target.store.getCapacity(RESOURCE_ENERGY);
    return target.store.getUsedCapacity(RESOURCE_ENERGY) >= cap * 0.8;
  }
  return false;
}

/** Find a source container (adjacent to a source) with ≥100 energy */
function getSourceContainer(creep: Creep): StructureContainer | null {
  const sources = creep.room.find(FIND_SOURCES);
  for (const source of sources) {
    const containers = source.pos.findInRange(FIND_STRUCTURES, 1, {
      filter: s => s.structureType === STRUCTURE_CONTAINER && s.store.getUsedCapacity(RESOURCE_ENERGY) >= 100
    });
    if (containers.length > 0) return containers[0] as StructureContainer;
  }
  return null;
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
