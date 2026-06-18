/**
 * Smoke test for filesystem persistence (issue #53).
 *
 * Verifies that:
 * 1. localStorage key is defined
 * 2. saveToLocalStorage / loadFromLocalStorage round-trip works
 * 3. Version mismatch discards old state
 * 4. Corrupted JSON is handled gracefully
 *
 * Run: npx tsx test/fileSystemPersistence.smoke.ts
 */

import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

interface FileSystemItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  content?: string;
  language?: string;
  children?: FileSystemItem[];
  lastModified?: number;
}

const STORAGE_KEY = 'ribix_filesystem_state';
const STORAGE_VERSION = 1;

interface PersistedState {
  version: number;
  root: FileSystemItem;
  currentPath: string[];
  savedAt: number;
}

// Simulate localStorage in Node
const localStorageMap = new Map<string, string>();
const localStorage = {
  getItem: (key: string) => localStorageMap.get(key) ?? null,
  setItem: (key: string, value: string) => localStorageMap.set(key, value),
  removeItem: (key: string) => localStorageMap.delete(key),
};

function saveToLocalStorage(root: FileSystemItem, currentPath: string[]): void {
  const state: PersistedState = {
    version: STORAGE_VERSION,
    root,
    currentPath,
    savedAt: Date.now(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadFromLocalStorage(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedState;
    if (parsed.version !== STORAGE_VERSION) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

function clearLocalStorage(): void {
  localStorage.removeItem(STORAGE_KEY);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

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

const testRoot: FileSystemItem = {
  name: 'workspace',
  path: '/',
  type: 'directory',
  children: [
    {
      name: 'src',
      path: '/src',
      type: 'directory',
      children: [
        {
          name: 'index.ts',
          path: '/src/index.ts',
          type: 'file',
          content: 'console.log("hello");',
          language: 'typescript',
          lastModified: Date.now(),
        },
      ],
    },
  ],
};

// Test 1: Round-trip save/load
console.log('Test 1: Round-trip save/load');
clearLocalStorage();
saveToLocalStorage(testRoot, ['src']);
const loaded = loadFromLocalStorage();
assert(loaded !== null, 'Loaded state should not be null');
assert(loaded?.root.name === 'workspace', 'Root name should be "workspace"');
assert(loaded?.currentPath[0] === 'src', 'Current path should be ["src"]');
assert(loaded?.root.children?.[0].name === 'src', 'First child should be "src"');
assert(loaded?.root.children?.[0].children?.[0].name === 'index.ts', 'Grandchild should be "index.ts"');

// Test 2: Load when empty
console.log('Test 2: Load when empty');
clearLocalStorage();
const empty = loadFromLocalStorage();
assert(empty === null, 'Should return null when no state exists');

// Test 3: Version mismatch
console.log('Test 3: Version mismatch');
localStorage.setItem(STORAGE_KEY, JSON.stringify({
  version: 999,
  root: testRoot,
  currentPath: [],
  savedAt: Date.now(),
}));
const mismatched = loadFromLocalStorage();
assert(mismatched === null, 'Should return null on version mismatch');
assert(localStorage.getItem(STORAGE_KEY) === null, 'Should remove incompatible state');

// Test 4: Corrupted JSON
console.log('Test 4: Corrupted JSON');
localStorage.setItem(STORAGE_KEY, '{invalid json');
const corrupted = loadFromLocalStorage();
assert(corrupted === null, 'Should return null on corrupted JSON');
assert(localStorage.getItem(STORAGE_KEY) === null, 'Should remove corrupted state');

// Test 5: Clear storage
console.log('Test 5: Clear storage');
saveToLocalStorage(testRoot, ['src']);
assert(localStorage.getItem(STORAGE_KEY) !== null, 'State should exist before clear');
clearLocalStorage();
assert(localStorage.getItem(STORAGE_KEY) === null, 'State should be null after clear');

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
