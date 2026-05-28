# Apocrypha — Improvement Backlog

> Read by the cron agent on each iteration. Prioritized. Items move to CHANGELOG.md when completed.

## Status Key
- `[ ]` pending
- `[~]` in progress
- `[x]` done (moved to CHANGELOG.md)
- `[!]` blocked

## Priority 1 — Structural (Room Mechanics)

- [ ] **Construction planner** — automatically place extension, road, and container sites based on RCL. Extensions in ring around spawn, roads spawn→sources→controller, containers adjacent to sources. Ref: https://docs.screeps.com/control.html
- [ ] **Builder priority system** — builders choose targets by structure type priority (extensions > containers > roads > ramparts > repair). Currently builders take nearest site regardless of importance.
- [ ] **Extension completion** — colony at RCL 2 with 0/5 extensions built. Unlocks 250 extra energy capacity → bigger creeps.

## Priority 2 — Creep Optimization

- [ ] **Hauler role** — dedicated transport creeps (CARRY+MOVE) to move energy between containers and spawn/extensions. Unlocks at RCL 3+ when containers exist. Ref: community standard for decoupling harvest from transport.
- [ ] **Static miner pattern** — at RCL 3+ with containers: spawn miners (5 WORK, 1 MOVE) that sit on a container next to a source. Haulers empty the container. Doubles energy throughput vs walking harvesters. Ref: Screeps forums — "5 WORK fully drains one source"
- [ ] **Body scaling by energy budget** — creep body sizes should proportionally scale with room energy capacity, not just fixed tiers. A 550e room should build 2-tool creeps even if 3-tool is affordable.

## Priority 3 — Multi-Room

- [ ] **Room expansion logic** — at GCL 2+, scout adjacent rooms, claim a second room. Needs claimer creep role.
- [ ] **Multi-room spawning** — spawn manager handles multiple rooms independently.

## Priority 4 — Defense (RCL 3+)

- [ ] **Tower management** — at RCL 3: keep tower filled with energy, auto-repair structures below 50%, auto-attack hostiles. Ref: https://docs.screeps.com/control.html
- [ ] **Safe mode detection** — detect incoming attacks, trigger safemode if available.
- [ ] **Rampart placement** — basic defensive wall around spawn/core structures.

## Priority 5 — Economy & Live Server

- [ ] **Market trading** — buy/sell energy and minerals via market API. Requires RCL 4+ storage.
- [ ] **Shard2 deployment** — deploy bot to live server once local colony reaches RCL 4 stability.
- [ ] **Memory compaction** — periodically clean stale Memory entries to reduce parse overhead.

## Priority 6 — Agent Infrastructure

- [ ] **Daily performance report** — cron generates summary: GCL progress, energy trends, creep counts, issues resolved.
- [ ] **Regression test suite** — unit tests for spawn manager quotas, builder priority, construction planner.
- [ ] **Rollback mechanism** — if deploy causes creep die-off or energy crash, auto-revert to last known good commit.

---

*Updated: 2026-05-27 | Agent: Ava*
