/**
 * Smoke test for code signing configuration (issue #60).
 *
 * Verifies that:
 * 1. build-release.yml has macOS signing steps
 * 2. build-release.yml has macOS notarization steps
 * 3. build-release.yml has Windows signing steps
 * 4. All signing steps are conditional on secrets being present
 * 5. Certificate cleanup steps exist
 *
 * Run: npx tsx test/codeSigning.smoke.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workflowPath = resolve(process.cwd(), '.github/workflows/build-release.yml');
const content = readFileSync(workflowPath, 'utf-8');

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

console.log('Test: Code signing configuration (issue #60)');

// macOS signing
assert(content.includes('Import signing certificate'), 'macOS: certificate import step exists');
assert(content.includes('MACOS_CERTIFICATE_P12'), 'macOS: references MACOS_CERTIFICATE_P12 secret');
assert(content.includes('security create-keychain'), 'macOS: creates temporary keychain');
assert(content.includes('security import'), 'macOS: imports certificate to keychain');
assert(content.includes('Sign macOS app'), 'macOS: app signing step exists');
assert(content.includes('codesign'), 'macOS: uses codesign tool');
assert(content.includes('options runtime'), 'macOS: uses runtime option for hardened runtime');

// macOS notarization
assert(content.includes('Notarize macOS app'), 'macOS: notarization step exists');
assert(content.includes('notarytool submit'), 'macOS: uses notarytool for notarization');
assert(content.includes('stapler staple'), 'macOS: staples notarization ticket');

// Windows signing
assert(content.includes('Decode signing certificate'), 'Windows: certificate decode step exists');
assert(content.includes('WINDOWS_CERTIFICATE_PFX'), 'Windows: references WINDOWS_CERTIFICATE_PFX secret');
assert(content.includes('Sign Windows binary'), 'Windows: signing step exists');
assert(content.includes('signtool sign'), 'Windows: uses signtool for signing');
assert(content.includes('sha256'), 'Windows: uses SHA256 digest');

// Conditional execution
assert(content.includes("secrets.MACOS_CERTIFICATE_P12 != ''"), 'macOS: signing is conditional on secret');
assert(content.includes("secrets.WINDOWS_CERTIFICATE_PFX != ''"), 'Windows: signing is conditional on secret');

// Cleanup
assert(content.includes('Clean up keychain'), 'macOS: keychain cleanup step exists');
assert(content.includes('Clean up certificate'), 'Windows: certificate cleanup step exists');
assert(content.includes('if: ${{ always() }}'), 'Cleanup steps run always (even on failure)');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
