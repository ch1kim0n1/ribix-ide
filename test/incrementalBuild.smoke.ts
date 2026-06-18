/**
 * Smoke test for incremental build config (issue #59).
 *
 * Verifies that:
 * 1. vite.config.ts has manifest: true
 * 2. vite.config.ts has manualChunks for vendor splitting
 * 3. vite.config.ts has cacheDir set
 *
 * Run: npx tsx test/incrementalBuild.smoke.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const configPath = resolve(process.cwd(), 'web-ide/vite.config.ts');
const configContent = readFileSync(configPath, 'utf-8');

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

console.log('Test: Incremental build configuration (issue #59)');

assert(configContent.includes('manifest: true'), 'manifest: true should be set for chunk tracking');
assert(configContent.includes('manualChunks'), 'manualChunks should be set for vendor splitting');
assert(configContent.includes('react-vendor'), 'react-vendor chunk should be defined');
assert(configContent.includes('monaco-vendor'), 'monaco-vendor chunk should be defined');
assert(configContent.includes('collaboration-vendor'), 'collaboration-vendor chunk should be defined');
assert(configContent.includes('cacheDir'), 'cacheDir should be set for incremental rebuilds');
assert(configContent.includes('sourcemap: true'), 'sourcemap should be enabled for debugging');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
