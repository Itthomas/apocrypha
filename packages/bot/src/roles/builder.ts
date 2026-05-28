/**
 * roles/builder.ts — Construction creep
 *
 * Pulls energy from the spawn overflow container only.
 * Spawns only when container ≥50% full and construction sites exist.
 * Max 2 builders alive at a time.
 * Build priority: extensions > containers > tower > roads > ramparts > walls.
 */

interface BuilderMemory {
  role: 'builder';
  building: boolean;
  targetId?: Id<ConstructionSite | Structure>;
}

/** Build priority order by structure type (lower = build first) */
const BUILD_PRIORITY: Record<string, number> = {
  [STRUCTURE_EXTENSION]: 1,
  [STRUCTURE_CONTAINER]: 2,
  [STRUCTURE_TOWER]:    3,
  [STRUCTURE_STORAGE]:  4,
  [STRUCTURE_ROAD]:     5,
  [STRUCTURE_RAMPART]:  6,
  [STRUCTURE_WALL]:     7,
};

/** Get the spawn overflow container */
function getOverflowContainer(room: Room): StructureContainer | null {
  const spawns = room.find(FIND_MY_SPAWNS);
  if (spawns.length === 0) return null;
  return spawns[0].pos.findInRange(FIND_STRUCTURES, 3, {
    filter: s => s.structureType === STRUCTURE_CONTAINER
  })[0] as StructureContainer | null;
}

export function run(creep: Creep): boolean {
  const mem = creep.memory as BuilderMemory;

  if (creep.store.getFreeCapacity() === 0) mem.building = true;
  if (creep.store.getUsedCapacity() === 0) {
    mem.building = false;
    mem.targetId = undefined;
  }

  // BUILD
  if (mem.building) {
    let target: ConstructionSite | Structure | null = null;

    if (mem.targetId) {
      target = Game.getObjectById(mem.targetId);
    }

    if (!target) {
      const allSites = creep.room.find(FIND_CONSTRUCTION_SITES);
      // Sort by build priority
      allSites.sort((a, b) =>
        (BUILD_PRIORITY[a.structureType] || 99) - (BUILD_PRIORITY[b.structureType] || 99)
      );
      target = allSites.length > 0 ? allSites[0] : null;
    }

    if (!target) {
      // No construction sites — repair damaged structures (priority order)
      const damaged = creep.room.find(FIND_STRUCTURES, {
        filter: s => s.hits < s.hitsMax * 0.5 && s.structureType !== STRUCTURE_WALL
      });
      damaged.sort((a, b) =>
        (BUILD_PRIORITY[a.structureType] || 99) - (BUILD_PRIORITY[b.structureType] || 99)
      );
      target = damaged.length > 0 ? damaged[0] : null;
    }

    if (!target) return false; // Nothing to do

    mem.targetId = target.id;

    let result: ScreepsReturnCode;
    if (target instanceof ConstructionSite) {
      result = creep.build(target);
    } else {
      result = creep.repair(target);
    }

    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(target);
    } else if (result === OK) {
      if ((target instanceof ConstructionSite && !Game.getObjectById(target.id)) ||
          (target instanceof Structure && target.hits >= target.hitsMax)) {
        mem.targetId = undefined;
      }
    }
    return true;
  }

  // WITHDRAW from spawn overflow container only
  const container = getOverflowContainer(creep.room);
  if (container && container.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
    if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
      creep.moveTo(container);
    }
    return true;
  }

  return false;
}
