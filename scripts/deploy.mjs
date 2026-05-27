/**
 * scripts/deploy.mjs — Apocrypha Deploy Script
 *
 * Pushes dist/main.js to a Screeps server.
 * --local  → local private server (default: http://localhost:21025)
 * --live   → official Screeps server (uses SCREEPS_TOKEN from env)
 */

import { readFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';

const ROOT = dirname(dirname(new URL(import.meta.url).pathname));
const DIST = resolve(ROOT, 'dist/main.js');

// Parse flags
const isLive = process.argv.includes('--live');
const isLocal = process.argv.includes('--local') || !isLive;

if (!existsSync(DIST)) {
  console.error('[deploy] dist/main.js not found. Run `npm run build` first.');
  process.exit(1);
}

const code = readFileSync(DIST, 'utf-8');

async function deploy() {
  if (isLocal) {
    // Local private server via screeps-launcher CLI
    const port = process.env.SCREEPS_LOCAL_PORT || '21025';

    // screeps-launcher uses its own CLI for code upload
    // For now, write directly via the in-server console or mod
    console.log(`[deploy] Local server at http://localhost:${port}`);

    // Use curl to upload via the mod/HTTP endpoint
    const serverUrl = process.env.SCREEPS_LOCAL_URL || `http://localhost:${port}`;
    const token = process.env.SCREEPS_LOCAL_TOKEN || '';

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (token) headers['X-Token'] = token;

    try {
      const resp = await fetch(`${serverUrl}/api/user/code`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          branch: 'default',
          modules: { main: code }
        })
      });

      const data = await resp.json();
      if (resp.ok) {
        console.log('[deploy] ✓ Local deploy successful');
      } else {
        console.error('[deploy] Local deploy failed:', data);
        // Fall back to file copy for screeps-launcher
        console.log('[deploy] Attempting manual copy to screeps-launcher...');
        const launcherModDir = process.env.SCREEPS_LAUNCHER_DIR;
        if (launcherModDir) {
          const { writeFileSync } = await import('fs');
          writeFileSync(resolve(launcherModDir, 'main.js'), code);
          console.log(`[deploy] ✓ Copied to ${launcherModDir}/main.js`);
        }
      }
    } catch (e) {
      console.error('[deploy] Local server not reachable. Is it running?');
      console.error(e);
    }
  }

  if (isLive) {
    const token = process.env.SCREEPS_TOKEN;
    if (!token) {
      console.error('[deploy] SCREEPS_TOKEN not set. Skipping live deploy.');
      return;
    }

    try {
      const resp = await fetch('https://screeps.com/api/user/code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Token': token
        },
        body: JSON.stringify({
          branch: 'default',
          modules: { main: code }
        })
      });

      if (resp.ok) {
        console.log('[deploy] ✓ Live deploy successful (shard2)');
      } else {
        const data = await resp.text();
        console.error('[deploy] Live deploy failed:', resp.status, data);
      }
    } catch (e) {
      console.error('[deploy] Live deploy error:', e);
    }
  }
}

deploy().catch(e => {
  console.error('[deploy] Error:', e);
  process.exit(1);
});
