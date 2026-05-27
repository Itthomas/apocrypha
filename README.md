# Apocrypha

The AI-managed Screeps colony. Built in collaboration between Isaac and Ava.

## Architecture

```
apocrypha/
├── packages/bot/          # Colony AI (TypeScript)
│   └── src/
│       ├── main.ts        # Entry point — exports loop()
│       ├── spawnManager.ts # Spawn queue and creep quotas
│       ├── roles/         # Creep behavior per role
│       │   ├── harvester.ts
│       │   ├── builder.ts
│       │   ├── upgrader.ts
│       │   └── hauler.ts  # (RCL 3+)
│       └── telemetry/     # Memory.stats bridge to MCP agent
│           ├── index.ts
│           └── types.ts
├── scripts/
│   └── deploy.mjs         # Deploy to local or live server
├── build.mjs              # esbuild bundler
└── .screeps/              # Local private server config
    └── config.yml
```

## Quick Start

```bash
# Install dependencies
npm install

# Start local Screeps server
docker run -d --name apocrypha-server \
  -v $PWD/.screeps:/data \
  -p 21025:21025 \
  screepers/screeps-launcher

# Build the bot
npm run build

# Deploy to local server
npm run deploy:local

# Run tests
npm test
```

## Telemetry (Agent Dashboard)

The bot writes structured stats to `Memory.stats` every 20 ticks. The Ava agent reads this via the Screeps MCP server (`mcporter`) to:

1. Monitor CPU bucket, energy flow, creep populations
2. Detect regressions (stuck creeps, ratio drift, energy starvation)
3. Propose and deploy code improvements

## Deploying to Live (Shard2)

```bash
SCREEPS_TOKEN=your_token npm run deploy:live
```

## License

MIT
