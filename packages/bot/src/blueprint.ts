/**
 * blueprint.ts — Static base blueprint, spawn-relative
 *
 * All positions are offsets from the primary spawn (0,0).
 * RCL → batch number → array of { name, x, y } entries.
 *
 * Empty batches signal slots for dynamic placement (extensions
 * that don't fit the rigid skeleton, roads to sources, etc.).
 */

export interface BlueprintEntry {
  name: BuildableStructureConstant;
  x: number;
  y: number;
}

export type Blueprint = Record<number, Record<number, BlueprintEntry[]>>;

// ── Blueprint Data ──

const RAW: Record<string, Record<string, Array<{ name: string; x: number; y: number }>>> = {
  "2": {
    "1": [
      { "name": "extension", "y": -4, "x": -3 },
      { "name": "extension", "y": -5, "x": -2 },
      { "name": "extension", "y": -4, "x": -2 },
      { "name": "extension", "y": -3, "x": -2 },
      { "name": "extension", "y": -4, "x": -1 }
    ],
    "2": [
      { "name": "road", "y": -5, "x": -7 },
      { "name": "road", "y": -4, "x": -7 },
      { "name": "road", "y": -3, "x": -7 },
      { "name": "road", "y": -6, "x": -6 },
      { "name": "road", "y": -2, "x": -6 },
      { "name": "road", "y": -7, "x": -5 },
      { "name": "road", "y": -5, "x": -5 },
      { "name": "road", "y": -3, "x": -5 },
      { "name": "road", "y": -1, "x": -5 },
      { "name": "road", "y": -8, "x": -4 },
      { "name": "road", "y": -4, "x": -4 },
      { "name": "road", "y": 0, "x": -4 },
      { "name": "road", "y": -9, "x": -3 },
      { "name": "road", "y": -7, "x": -3 },
      { "name": "road", "y": -5, "x": -3 },
      { "name": "road", "y": -3, "x": -3 },
      { "name": "road", "y": -1, "x": -3 },
      { "name": "road", "y": 1, "x": -3 },
      { "name": "road", "y": -10, "x": -2 },
      { "name": "road", "y": -6, "x": -2 },
      { "name": "road", "y": -2, "x": -2 },
      { "name": "road", "y": -1, "x": -2 },
      { "name": "road", "y": 0, "x": -2 },
      { "name": "road", "y": 2, "x": -2 },
      { "name": "road", "y": -11, "x": -1 },
      { "name": "road", "y": -9, "x": -1 },
      { "name": "road", "y": -7, "x": -1 },
      { "name": "road", "y": -5, "x": -1 },
      { "name": "road", "y": -3, "x": -1 },
      { "name": "road", "y": 1, "x": -1 },
      { "name": "road", "y": 3, "x": -1 },
      { "name": "road", "y": -11, "x": 0 },
      { "name": "road", "y": -8, "x": 0 },
      { "name": "road", "y": -4, "x": 0 },
      { "name": "road", "y": -3, "x": 0 },
      { "name": "road", "y": 1, "x": 0 },
      { "name": "road", "y": 3, "x": 0 },
      { "name": "road", "y": -11, "x": 1 },
      { "name": "road", "y": -9, "x": 1 },
      { "name": "road", "y": -7, "x": 1 },
      { "name": "road", "y": -5, "x": 1 },
      { "name": "road", "y": -3, "x": 1 },
      { "name": "road", "y": 1, "x": 1 },
      { "name": "road", "y": 3, "x": 1 },
      { "name": "road", "y": -10, "x": 2 },
      { "name": "road", "y": -6, "x": 2 },
      { "name": "road", "y": -2, "x": 2 },
      { "name": "road", "y": -1, "x": 2 },
      { "name": "road", "y": 0, "x": 2 },
      { "name": "road", "y": 2, "x": 2 },
      { "name": "road", "y": -9, "x": 3 },
      { "name": "road", "y": -7, "x": 3 },
      { "name": "road", "y": -5, "x": 3 },
      { "name": "road", "y": -3, "x": 3 },
      { "name": "road", "y": -1, "x": 3 },
      { "name": "road", "y": 1, "x": 3 },
      { "name": "road", "y": -8, "x": 4 },
      { "name": "road", "y": -4, "x": 4 },
      { "name": "road", "y": 0, "x": 4 },
      { "name": "road", "y": -7, "x": 5 },
      { "name": "road", "y": -5, "x": 5 },
      { "name": "road", "y": -3, "x": 5 },
      { "name": "road", "y": -1, "x": 5 },
      { "name": "road", "y": -6, "x": 6 },
      { "name": "road", "y": -2, "x": 6 },
      { "name": "road", "y": -5, "x": 7 },
      { "name": "road", "y": -4, "x": 7 },
      { "name": "road", "y": -3, "x": 7 }
    ]
  },
  "3": {
    "1": [
      { "name": "extension", "y": -4, "x": 1 },
      { "name": "extension", "y": -5, "x": 2 },
      { "name": "extension", "y": -4, "x": 2 },
      { "name": "extension", "y": -3, "x": 2 },
      { "name": "extension", "y": -4, "x": 3 }
    ],
    "2": [
      { "name": "tower", "y": -2, "x": 0 }
    ]
  },
  "4": {
    "1": [
      { "name": "extension", "y": -2, "x": -5 },
      { "name": "extension", "y": -3, "x": -4 },
      { "name": "extension", "y": -2, "x": -4 },
      { "name": "extension", "y": -1, "x": -4 },
      { "name": "extension", "y": -2, "x": -3 },
      { "name": "extension", "y": -2, "x": 3 },
      { "name": "extension", "y": -3, "x": 4 },
      { "name": "extension", "y": -2, "x": 4 },
      { "name": "extension", "y": -1, "x": 4 },
      { "name": "extension", "y": -2, "x": 5 }
    ],
    "2": [
      { "name": "storage", "y": -2, "x": -1 }
    ]
  },
  "5": {
    "1": [
      { "name": "extension", "y": -5, "x": -6 },
      { "name": "extension", "y": -3, "x": -6 },
      { "name": "extension", "y": 0, "x": -3 },
      { "name": "extension", "y": 1, "x": -2 },
      { "name": "extension", "y": 2, "x": -1 },
      { "name": "extension", "y": 2, "x": 1 },
      { "name": "extension", "y": 1, "x": 2 },
      { "name": "extension", "y": 0, "x": 3 },
      { "name": "extension", "y": -5, "x": 6 },
      { "name": "extension", "y": -3, "x": 6 }
    ],
    "2": [
      { "name": "tower", "y": 2, "x": 0 }
    ],
    "3": [
      { "name": "rampart", "y": -5, "x": -7 },
      { "name": "rampart", "y": -4, "x": -7 },
      { "name": "rampart", "y": -3, "x": -7 },
      { "name": "rampart", "y": -6, "x": -6 },
      { "name": "rampart", "y": -5, "x": -6 },
      { "name": "rampart", "y": -3, "x": -6 },
      { "name": "rampart", "y": -2, "x": -6 },
      { "name": "rampart", "y": -7, "x": -5 },
      { "name": "rampart", "y": -6, "x": -5 },
      { "name": "rampart", "y": -2, "x": -5 },
      { "name": "rampart", "y": -1, "x": -5 },
      { "name": "rampart", "y": -8, "x": -4 },
      { "name": "rampart", "y": -7, "x": -4 },
      { "name": "rampart", "y": -1, "x": -4 },
      { "name": "rampart", "y": 0, "x": -4 },
      { "name": "rampart", "y": -9, "x": -3 },
      { "name": "rampart", "y": -8, "x": -3 },
      { "name": "rampart", "y": 0, "x": -3 },
      { "name": "rampart", "y": 1, "x": -3 },
      { "name": "rampart", "y": -10, "x": -2 },
      { "name": "rampart", "y": -9, "x": -2 },
      { "name": "rampart", "y": 1, "x": -2 },
      { "name": "rampart", "y": 2, "x": -2 },
      { "name": "rampart", "y": -11, "x": -1 },
      { "name": "rampart", "y": -10, "x": -1 },
      { "name": "rampart", "y": 2, "x": -1 },
      { "name": "rampart", "y": 3, "x": -1 },
      { "name": "rampart", "y": -11, "x": 0 },
      { "name": "rampart", "y": 3, "x": 0 },
      { "name": "rampart", "y": -11, "x": 1 },
      { "name": "rampart", "y": -10, "x": 1 },
      { "name": "rampart", "y": 2, "x": 1 },
      { "name": "rampart", "y": 3, "x": 1 },
      { "name": "rampart", "y": -10, "x": 2 },
      { "name": "rampart", "y": -9, "x": 2 },
      { "name": "rampart", "y": 1, "x": 2 },
      { "name": "rampart", "y": 2, "x": 2 },
      { "name": "rampart", "y": -9, "x": 3 },
      { "name": "rampart", "y": -8, "x": 3 },
      { "name": "rampart", "y": 0, "x": 3 },
      { "name": "rampart", "y": 1, "x": 3 },
      { "name": "rampart", "y": -8, "x": 4 },
      { "name": "rampart", "y": -7, "x": 4 },
      { "name": "rampart", "y": -1, "x": 4 },
      { "name": "rampart", "y": 0, "x": 4 },
      { "name": "rampart", "y": -7, "x": 5 },
      { "name": "rampart", "y": -6, "x": 5 },
      { "name": "rampart", "y": -2, "x": 5 },
      { "name": "rampart", "y": -1, "x": 5 },
      { "name": "rampart", "y": -6, "x": 6 },
      { "name": "rampart", "y": -5, "x": 6 },
      { "name": "rampart", "y": -3, "x": 6 },
      { "name": "rampart", "y": -2, "x": 6 },
      { "name": "rampart", "y": -5, "x": 7 },
      { "name": "rampart", "y": -4, "x": 7 },
      { "name": "rampart", "y": -3, "x": 7 }
    ]
  },
  "6": {
    "1": [
      { "name": "extension", "y": -6, "x": -5 },
      { "name": "extension", "y": -4, "x": -5 },
      { "name": "extension", "y": -7, "x": -4 },
      { "name": "extension", "y": -5, "x": -4 },
      { "name": "extension", "y": -6, "x": -3 },
      { "name": "extension", "y": -6, "x": 3 },
      { "name": "extension", "y": -7, "x": 4 },
      { "name": "extension", "y": -5, "x": 4 },
      { "name": "extension", "y": -6, "x": 5 },
      { "name": "extension", "y": -4, "x": 5 }
    ],
    "2": [
      { "name": "link", "y": -1, "x": -1 }
    ],
    "3": [
      { "name": "terminal", "y": -1, "x": 1 }
    ],
    "4": [
      { "name": "lab", "y": -8, "x": -1 },
      { "name": "lab", "y": -9, "x": 0 },
      { "name": "lab", "y": -7, "x": 0 }
    ]
  },
  "7": {
    "1": [
      { "name": "extension", "y": -8, "x": -3 },
      { "name": "extension", "y": -10, "x": -1 },
      { "name": "extension", "y": -6, "x": -1 },
      { "name": "extension", "y": -5, "x": 0 },
      { "name": "extension", "y": -10, "x": 1 },
      { "name": "extension", "y": -6, "x": 1 },
      { "name": "extension", "y": -8, "x": 3 }
    ],
    "2": [],
    "3": [
      { "name": "tower", "y": -10, "x": 0 }
    ],
    "4": [
      { "name": "spawn", "y": -6, "x": 4 }
    ],
    "5": [
      { "name": "lab", "y": -8, "x": -2 },
      { "name": "lab", "y": -8, "x": 1 },
      { "name": "lab", "y": -8, "x": 2 }
    ],
    "6": [
      { "name": "factory", "y": 0, "x": -1 }
    ],
    "7": [
      { "name": "rampart", "y": -4, "x": -6 },
      { "name": "rampart", "y": -5, "x": -5 },
      { "name": "rampart", "y": -4, "x": -5 },
      { "name": "rampart", "y": -3, "x": -5 },
      { "name": "rampart", "y": -6, "x": -4 },
      { "name": "rampart", "y": -5, "x": -4 },
      { "name": "rampart", "y": -3, "x": -4 },
      { "name": "rampart", "y": -2, "x": -4 },
      { "name": "rampart", "y": -7, "x": -3 },
      { "name": "rampart", "y": -6, "x": -3 },
      { "name": "rampart", "y": -2, "x": -3 },
      { "name": "rampart", "y": -1, "x": -3 },
      { "name": "rampart", "y": -8, "x": -2 },
      { "name": "rampart", "y": -7, "x": -2 },
      { "name": "rampart", "y": -1, "x": -2 },
      { "name": "rampart", "y": 0, "x": -2 },
      { "name": "rampart", "y": -9, "x": -1 },
      { "name": "rampart", "y": -8, "x": -1 },
      { "name": "rampart", "y": 0, "x": -1 },
      { "name": "rampart", "y": 1, "x": -1 },
      { "name": "rampart", "y": -10, "x": 0 },
      { "name": "rampart", "y": -9, "x": 0 },
      { "name": "rampart", "y": 1, "x": 0 },
      { "name": "rampart", "y": 2, "x": 0 },
      { "name": "rampart", "y": -9, "x": 1 },
      { "name": "rampart", "y": -8, "x": 1 },
      { "name": "rampart", "y": 0, "x": 1 },
      { "name": "rampart", "y": 1, "x": 1 },
      { "name": "rampart", "y": -8, "x": 2 },
      { "name": "rampart", "y": -7, "x": 2 },
      { "name": "rampart", "y": -1, "x": 2 },
      { "name": "rampart", "y": 0, "x": 2 },
      { "name": "rampart", "y": -7, "x": 3 },
      { "name": "rampart", "y": -6, "x": 3 },
      { "name": "rampart", "y": -2, "x": 3 },
      { "name": "rampart", "y": -1, "x": 3 },
      { "name": "rampart", "y": -6, "x": 4 },
      { "name": "rampart", "y": -5, "x": 4 },
      { "name": "rampart", "y": -3, "x": 4 },
      { "name": "rampart", "y": -2, "x": 4 },
      { "name": "rampart", "y": -5, "x": 5 },
      { "name": "rampart", "y": -4, "x": 5 },
      { "name": "rampart", "y": -3, "x": 5 },
      { "name": "rampart", "y": -4, "x": 6 }
    ]
  },
  "8": {
    "1": [],
    "2": [
      { "name": "tower", "y": -4, "x": -6 },
      { "name": "tower", "y": -6, "x": 0 },
      { "name": "tower", "y": -4, "x": 6 }
    ],
    "3": [
      { "name": "lab", "y": -9, "x": -2 },
      { "name": "lab", "y": -7, "x": -2 },
      { "name": "lab", "y": -9, "x": 2 },
      { "name": "lab", "y": -7, "x": 2 }
    ],
    "4": [
      { "name": "spawn", "y": -6, "x": -4 }
    ],
    "5": [
      { "name": "rampart", "y": -4, "x": -4 },
      { "name": "rampart", "y": -5, "x": -3 },
      { "name": "rampart", "y": -4, "x": -3 },
      { "name": "rampart", "y": -3, "x": -3 },
      { "name": "rampart", "y": -6, "x": -2 },
      { "name": "rampart", "y": -5, "x": -2 },
      { "name": "rampart", "y": -4, "x": -2 },
      { "name": "rampart", "y": -3, "x": -2 },
      { "name": "rampart", "y": -2, "x": -2 },
      { "name": "rampart", "y": -7, "x": -1 },
      { "name": "rampart", "y": -6, "x": -1 },
      { "name": "rampart", "y": -5, "x": -1 },
      { "name": "rampart", "y": -4, "x": -1 },
      { "name": "rampart", "y": -3, "x": -1 },
      { "name": "rampart", "y": -2, "x": -1 },
      { "name": "rampart", "y": -1, "x": -1 },
      { "name": "rampart", "y": -8, "x": 0 },
      { "name": "rampart", "y": -7, "x": 0 },
      { "name": "rampart", "y": -6, "x": 0 },
      { "name": "rampart", "y": -5, "x": 0 },
      { "name": "rampart", "y": -4, "x": 0 },
      { "name": "rampart", "y": -3, "x": 0 },
      { "name": "rampart", "y": -2, "x": 0 },
      { "name": "rampart", "y": -1, "x": 0 },
      { "name": "rampart", "y": -7, "x": 1 },
      { "name": "rampart", "y": -6, "x": 1 },
      { "name": "rampart", "y": -5, "x": 1 },
      { "name": "rampart", "y": -4, "x": 1 },
      { "name": "rampart", "y": -3, "x": 1 },
      { "name": "rampart", "y": -2, "x": 1 },
      { "name": "rampart", "y": -1, "x": 1 },
      { "name": "rampart", "y": -6, "x": 2 },
      { "name": "rampart", "y": -5, "x": 2 },
      { "name": "rampart", "y": -4, "x": 2 },
      { "name": "rampart", "y": -3, "x": 2 },
      { "name": "rampart", "y": -2, "x": 2 },
      { "name": "rampart", "y": -5, "x": 3 },
      { "name": "rampart", "y": -4, "x": 3 },
      { "name": "rampart", "y": -3, "x": 3 },
      { "name": "rampart", "y": -4, "x": 4 },
      { "name": "rampart", "y": 0, "x": 0 }
    ],
    "6": [
      { "name": "nuker", "y": -2, "x": -1 }
    ],
    "7": [
      { "name": "power_spawn", "y": 0, "x": 1 }
    ]
  }
};

// ── Convert string keys to numbers ──

function parse(): Blueprint {
  const bp: Blueprint = {};
  for (const rclStr of Object.keys(RAW)) {
    const rcl = parseInt(rclStr, 10);
    bp[rcl] = {};
    for (const batchStr of Object.keys(RAW[rclStr])) {
      const batch = parseInt(batchStr, 10);
      bp[rcl][batch] = RAW[rclStr][batchStr].map(e => ({
        name: e.name as BuildableStructureConstant,
        x: e.x,
        y: e.y
      }));
    }
  }
  return bp;
}

/** Parsed blueprint: RCL → batch → entries */
export const BLUEPRINT: Blueprint = parse();

/** Get static entries for a specific RCL and batch, or null if not found */
export function getStaticBatch(rcl: number, batch: number): BlueprintEntry[] | null {
  return BLUEPRINT[rcl]?.[batch] ?? null;
}

/** Check if a batch exists in the blueprint (even if empty) */
export function hasBatch(rcl: number, batch: number): boolean {
  return BLUEPRINT[rcl]?.[batch] !== undefined;
}
