# Apocrypha — Change Log

> Written by the cron agent after each change. Read CHANGELOG.md on every iteration for context on what's been done.

### [2026-05-28] Miner: affordable RCL 3 fallback body
**Category:** bot
**What changed:** Lowered miner RCL 3 fallback from `work:5` → `work:4` (cost 600e → 500e).
**Why:** At RCL 3, spawn+extensions only provide 550e total. Neither the primary (700e) nor the old fallback (600e) were affordable. The spawn manager would skip miners entirely, leaving the colony with zero energy income. The new fallback (4W/1C/1M = 500e) fits in RCL 3's budget.
**Result:** Miner spawned immediately on deploy. Colony recovered from 3→4 creeps, energy economy resumed.

### [2026-05-28] Survivor: bypass task lock when nothing to deliver
**Category:** bot
**What changed:** Survivors in DELIVER task now unconditionally switch to the next task when spawn + extensions are both full, instead of waiting for `taskLockedUntil` to expire. Removed `canSwitchTask(mem)` guard in `doDeliver` step 1c.
**Why:** All 4 survivors stuck with full bags, spawn at 300/300 (full), task=DELIVER, locked for 20 ticks. They burned ticks doing nothing — couldn't harvest (bags full), couldn't deliver (no hungry structures), couldn't switch (lock held). Zero energy harvested and zero controller progress for the entire window. The lock exists to prevent thrashing between equivalent tasks, not to force idling when the current task is impossible.
**Result:** Survivors immediately switched to UPGRADE → controller progress resumes. Harvest tracking resumes when they cycle back to HARVEST after spending energy.

### [2026-05-28] Monitor: RCL-aware role checks (survivors at low RCL)
**Category:** monitor
**What changed:** Fixed `scripts/monitor.mjs` — role balance checks were hardcoded to look for `harvester/miner/builder/upgrader` roles, but at RCL 1-2 only `survivor` creeps exist (generalists that do everything). Now uses RCL-dependent lookups: survivors count as harvesters, builders, and upgraders when RCL ≤ 2.
**Why:** False 🚨 alert "no miners" at RCL 1 with 4 survivors. Colony was perfectly healthy — the monitor just didn't understand the RCL-based role progression.
**Result:** Monitor exits clean (0) — no issues, only info note about full energy.

### [2026-05-28] Handle depleted sources in harvester
**Category:** bot
**What changed:** Harvesters now reassign to another source when `creep.harvest()` returns `ERR_NOT_ENOUGH_RESOURCES` (depleted source), instead of silently idling until the source regenerates.
**Why:** Zero-harvest stats window detected (tick 45840). With 3 harvesters in W7N4, if assigned sources deplete near-simultaneously, harvesters would stand idle for an entire 20-tick stats window. The new `else if (result === ERR_NOT_ENOUGH_RESOURCES)` branch clears `sourceId` to trigger reassignment.
**Result:** Colony healthy at tick 46040 — energy 44/300, 10 creeps, no issues.

### [2026-05-28] Stale deploy: rebuilt and redeployed from latest TypeScript source
**Category:** deploy
**What changed:** Rebuilt and redeployed all 9 modules from current TypeScript source. The deployed code in MongoDB was an older bundled build that lacked `isSourceReachable`, `safeTiers` spawn fallback, hauler drop/self-deliver logic, emergency harvester fallback, and had a hardcoded `150` body base cost instead of `200`.
**Why:** Zero energy harvested in W7N4 (energy at 94/300). The stale deploy meant several fixes already in source weren't running in production.
**Result:** Energy recovered from 94→184/300 in ~140 ticks. Colony healthy — no more zero-harvest alerts.

### [2026-05-28] Fix monitor fallback user ID
**Category:** infra
**What changed:** Updated hardcoded fallback user ID in `scripts/monitor.mjs` from `6a17aa5d3ffd6c003118021b` to actual user ID `6a17b83bd1eb500033b3ddea`.
**Why:** If the Mongo user lookup ever fails, the fallback needs to match the actual Screeps user or Redis memory lookups return empty.
**Result:** Fallback now points to correct user.

### [2026-05-28] Fix trackCreepHarvest not exported from telemetry module
**Category:** creep
**What changed:** Re-exported `trackCreepHarvest` from `telemetry/index.ts`. It was defined in `types.ts` but never made available to external consumers like `role.harvester`.
**Why:** At runtime, `trackCreepHarvest` was `undefined` when imported by harvester, causing a TypeError on every successful `creep.harvest()` call. This also prevented the preceding `trackHarvest()` room-level stat call's effect from landing properly, resulting in "zero energy harvested in stats window" monitor alerts.
**Result:** Built + deployed. Monitor shows colony healthy — no more zero-harvest alerts.

### [2026-05-27] Filter unreachable sources in harvester assignment
**Category:** creep
**What changed:** Added `isSourceReachable()` check in `role.harvester` — skips sources with all four adjacent tiles being walls (TERRAIN_MASK_WALL). Also added `ERR_NO_PATH` detection from `moveTo` to trigger reassignment when pathfinding fails.
**Why:** Source at (41,46) in W7N4 is completely walled off on all cardinal tiles. `assignSource` was assigning harvesters to it, permanently wasting them. Monitor showed "zero energy harvested in stats window" with full sources nearby.
**Result:** Harvesting resumed — spawn energy recovered from 56→174 within ~80 ticks. "Zero harvested" alert cleared on next monitor run.
**Refs:** https://docs.screeps.com/api/#Room.getTerrain

## Format
```
### [YYYY-MM-DD] Brief summary
**Category:** (structural | creep | defense | economy | infra)
**What changed:** ...
**Why:** ...
**Result:** (build output, colony metrics before/after)
**Refs:** (doc links, community posts)
```

---

## 2026-05-27

### Init Apocrypha — Screeps Colony Scaffold
**Category:** infra
**What changed:** Created TypeScript project with esbuild bundler. Role-based creep AI: harvester, builder, upgrader. Phase-based spawn manager (RCL 0-8). Telemetry module writes Memory.stats every 20 ticks.
**Why:** Fresh colony needs foundation. Isaac's shard2 account (MaximumEdgeLord, GCL 38) has no active colonies — starting from zero on local server.
**Result:** 6 modules, ~20KB total. Local Screeps server running via docker-compose (mongo + redis + screeps-launcher). MongoDB code injection deploys without API tokens.
**Refs:** https://docs.screeps.com | https://github.com/azcoigreach/screeps-mcp

### Fix spawn body budget — 200e base per triple
**Category:** creep
**What changed:** Changed body builder tier calculation from 150e to 200e base (WORK 100 + CARRY 50 + MOVE 50). Added safeTiers = max(1, floor(energyAvail / 200)).
**Why:** At RCL 1 with 300e capacity, Math.floor(300/150)=2 produced 400e bodies that spawn couldn't afford. Zero creeps spawned.
**Result:** Harvesters spawned immediately after fix. Colony went from 0→1→9 creeps.
**Refs:** BODYPART_COST from Screeps API

### Modular architecture — 6 separate Screeps modules
**Category:** structural
**What changed:** Split single-file bundle into 6 independent CommonJS modules: main (orchestrator), role.harvester, role.builder, role.upgrader, spawnManager, telemetry. Main uses require() for cross-module calls. Roles export run().
**Why:** Isaac wanted lean main file with imports. Separate modules enable targeted changes without full rebuild impact. Standard Screeps pattern (used by simplebot).
**Result:** main.js 2.5KB. Emergency harvester fallback added — if 0 harvesters, any creep harvests to prevent colony death.
**Refs:** https://docs.screeps.com/modules.html | simplebot source in @screeps/simplebot

### Deploy pipeline — MongoDB injection
**Category:** infra
**What changed:** Wrote scripts/deploy.mjs that injects all built modules into MongoDB users.code with timestamp. Engine detects timestamp change and recompiles. No API token needed.
**Why:** Private server has no token generation. Direct MongoDB writes bypass auth.
**Result:** `npm run deploy:local` → 6 modules → next tick. Colony monitor (scripts/monitor.mjs) reads Memory.stats from Redis. Cron job checks every 30 min.
**Refs:** MongoDB users.code schema reverse-engineered from server

---

*Last updated: 2026-05-27 17:45 PDT*
