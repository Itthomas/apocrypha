# Apocrypha — Change Log

> Written by the cron agent after each change. Read CHANGELOG.md on every iteration for context on what's been done.

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
