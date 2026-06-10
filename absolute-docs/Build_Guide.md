# Ribix IDE — Build Guide

**Purpose:** Document the build, packaging, and distribution process for Ribix IDE alpha release.

**Last Updated:** Phase 15 (2026-06-09)

---

## Overview

Ribix IDE is built on the Void editor fork (Code-OSS 1.99.3). The build process uses gulp tasks and follows the standard VS Code build pattern with Ribix-specific branding and configuration.

---

## Pre-Build Requirements

### System Requirements

- **Node.js:** 20.x (specified in `.nvmrc`)
- **Yarn:** Latest version
- **Python:** 3.x (for native module compilation)
- **macOS:** Xcode Command Line Tools (for code signing)
- **Windows:** Visual Studio Build Tools (for Windows signing)
- **Disk Space:** 10GB+ for full build artifacts

### Environment Setup

```bash
# Install dependencies
yarn install

# Build React layer
yarn buildreact

# Verify build
yarn compile
```

---

## Platform-Specific Build Commands

### macOS (Darwin)

#### x64 Build
```bash
# Build for macOS x64
yarn gulp vscode-darwin-x64

# Output: VSCode-darwin-x64/Ribix IDE.app
```

#### ARM64 Build (Apple Silicon)
```bash
# Build for macOS ARM64
yarn gulp vscode-darwin-arm64

# Output: VSCode-darwin-arm64/Ribix IDE.app
```

#### Universal Build
```bash
# Build universal binary (x64 + ARM64)
yarn gulp vscode-darwin

# Create universal app from separate builds
node build/darwin/create-universal-app.js

# Output: VSCode-darwin/Ribix IDE.app
```

### Windows

#### x64 Build
```bash
# Build for Windows x64
yarn gulp vscode-win32-x64

# Output: VSCode-win32-x64/RibixIDESetup.exe
```

#### ARM64 Build
```bash
# Build for Windows ARM64
yarn gulp vscode-win32-arm64

# Output: VSCode-win32-arm64/RibixIDESetup.exe
```

### Linux

#### x64 Build
```bash
# Build for Linux x64
yarn gulp vscode-linux-x64

# Output: VSCode-linux-x64/ribix-ide-[version].tar.gz
```

#### ARM64 Build
```bash
# Build for Linux ARM64
yarn gulp vscode-linux-arm64

# Output: VSCode-linux-arm64/ribix-ide-[version].tar.gz
```

---

## Code Signing

### macOS Code Signing

**Requirements:**
- Apple Developer Certificate (Developer ID Application)
- Certificate installed in macOS Keychain
- Entitlements files in `build/azure-pipelines/darwin/`

**Signing Process:**

```bash
# Set environment variables
export AGENT_BUILDDIRECTORY=$(pwd)/VSCode-darwin-x64
export AGENT_TEMPDIRECTORY=$(pwd)/temp
export CODESIGN_IDENTITY="Developer ID Application: Your Name (TEAM_ID)"
export VSCODE_ARCH="x64"  # or "arm64"

# Run signing script
node build/darwin/sign.js $AGENT_BUILDDIRECTORY
```

**What gets signed:**
1. Main application bundle (`Ribix IDE.app`)
2. Helper processes:
   - `Ribix IDE Helper (GPU).app`
   - `Ribix IDE Helper (Renderer).app`
   - `Ribix IDE Helper (Plugin).app`

**Entitlements:**
- Located in `build/azure-pipelines/darwin/`
- `app-entitlements.plist` - Main app entitlements
- `helper-gpu-entitlements.plist` - GPU helper entitlements
- `helper-renderer-entitlements.plist` - Renderer helper entitlements
- `helper-plugin-entitlements.plist` - Plugin helper entitlements

**Verification:**
```bash
# Verify signature
codesign -dv --verbose=4 VSCode-darwin-x64/Ribix\ IDE.app

# Verify all nested components
codesign -dv --verbose=4 --deep VSCode-darwin-x64/Ribix\ IDE.app
```

**Notarization (for distribution):**
```bash
# Upload to Apple for notarization
xcrun notarytool submit VSCode-darwin-x64/Ribix\ IDE.dmg \
  --apple-id "your@email.com" \
  --password "app-specific-password" \
  --team-id "TEAM_ID" \
  --wait

# Staple notarization ticket
xcrun stapler staple VSCode-darwin-x64/Ribix\ IDE.dmg
```

### Windows Code Signing

**Requirements:**
- Code signing certificate (Authenticode)
- Certificate installed in Windows Certificate Store
- `rcedit` tool (included in devDependencies)

**Signing Process:**

The Windows build process (Inno Setup installer) includes automatic signing if the following environment variables are set:

```powershell
# Set environment variables
$env:CODESIGN_CERTIFICATE_SHA1 = "YOUR_CERTIFICATE_SHA1_HASH"
$env:CODESIGN_PASSWORD = "YOUR_CERTIFICATE_PASSWORD"

# Build (signing happens automatically during build)
yarn gulp vscode-win32-x64
```

**Manual signing (if needed):**
```powershell
# Sign the main executable
rcedit VSCode-win32-x64/RibixIDE.exe \
  --set-version-string CompanyName "Ribix Inc." \
  --set-version-string FileDescription "Ribix IDE - Agent-first software engineering OS" \
  --set-version-string ProductName "Ribix IDE" \
  --set-file-version "1.99.3.0" \
  --set-product-version "1.99.3.0"
```

**Inno Setup Configuration:**
- Installer script: `build/win32/code.iss`
- Automatically signs installer if certificate is available
- Creates both user and system installer variants

---

## Auto-Update Endpoint Setup

### Update Server Configuration

**Endpoint:** `update.ribix.dev`

**Required API Response Format:**

```json
{
  "name": "1.99.3",
  "version": "1.99.3",
  "productVersion": "1.99.3",
  "url": "https://update.ribix.dev/darwin/x64/Ribix-IDE-1.99.3.dmg",
  "hash": "SHA256_HASH_OF_INSTALLER",
  "sha256hash": "SHA256_HASH_OF_INSTALLER",
  "platform": "darwin",
  "architecture": "x64",
  "releaseDate": "2026-06-09T00:00:00.000Z",
  "supportUrl": "https://github.com/ribix/ribix-ide/issues"
}
```

### Platform-Specific Endpoints

```
macOS x64:    https://update.ribix.dev/darwin/x64/latest.json
macOS ARM64:  https://update.ribix.dev/darwin/arm64/latest.json
macOS Universal: https://update.ribix.dev/darwin/universal/latest.json
Windows x64:  https://update.ribix.dev/win32/x64/latest.json
Windows ARM64: https://update.ribix.dev/win32/arm64/latest.json
Linux x64:    https://update.ribix.dev/linux/x64/latest.json
Linux ARM64:  https://update.ribix.dev/linux/arm64/latest.json
```

### Implementation in product.json

The update URL is configured in `product.json` (already set):

```json
{
  "updateUrl": "https://update.ribix.dev"
}
```

### Update Check Frequency

- **Default:** Check for updates every 8 hours
- **Manual check:** Command Palette → "Check for Updates"
- **Background check:** Runs on IDE startup if last check > 8 hours ago

---

## Distribution Artifacts

### Build Output Structure

```
VSCode-darwin-x64/
├── Ribix IDE.app/           # macOS application bundle
└── Ribix-IDE-1.99.3.dmg     # Disk image for distribution

VSCode-win32-x64/
├── RibixIDESetup.exe        # User installer
├── RibixIDESetup.exe        # System installer
└── RibixIDE-win32-x64.zip   # Archive version

VSCode-linux-x64/
├── ribix-ide-1.99.3.tar.gz  # Tarball for Linux
└── ribix-ide-1.99.3.deb     # Debian package (if generated)
```

### Checksum Generation

```bash
# Generate SHA256 checksums
shasum -a 256 VSCode-darwin-x64/Ribix-IDE-1.99.3.dmg > checksums-darwin.txt
shasum -a 256 VSCode-win32-x64/RibixIDESetup.exe > checksums-win32.txt
shasum -a 256 VSCode-linux-x64/ribix-ide-1.99.3.tar.gz > checksums-linux.txt
```

### Internal Distribution

**For alpha release:**

1. **Upload to internal storage:**
   - S3 bucket: `s3://ribix-internal-releases/alpha/1.99.3/`
   - Include all platform artifacts and checksums

2. **Generate download links:**
   - Use signed S3 URLs with 7-day expiration
   - Distribute via internal Slack/Email

3. **Version tagging:**
   ```bash
   git tag -a v1.99.3-alpha -m "Alpha release 1.99.3"
   git push origin v1.99.3-alpha
   ```

---

## Verification Checklist

Before distributing any build, verify:

- [ ] `product.json` has correct Ribix branding
- [ ] Application name is "Ribix IDE" in title bar
- [ ] About dialog shows "Ribix IDE" and correct version
- [ ] Dock icon (macOS) shows Ribix logo
- [ ] Code signing verified (no security warnings on launch)
- [ ] Auto-update endpoint is reachable
- [ ] All platforms build successfully
- [ ] Checksums match uploaded files
- [ ] E2E QA checklist passes (see `E2E_QA_Checklist.md`)

---

## Troubleshooting

### Build Failures

**Issue:** Native module compilation fails
```bash
# Solution: Rebuild native modules
yarn install --rebuild
```

**Issue:** React layer not included in build
```bash
# Solution: Rebuild React layer
yarn buildreact
yarn gulp vscode-darwin-x64
```

### Signing Issues

**Issue:** Code signing identity not found
```bash
# List available identities
security find-identity -v -p codesigning

# Set correct identity
export CODESIGN_IDENTITY="Developer ID Application: Your Name (TEAM_ID)"
```

**Issue:** Notarization fails
```bash
# Check notarization status
xcrun notarytool history

# Request new app-specific password at appleid.apple.com
```

### Auto-Update Issues

**Issue:** Update check fails
- Verify `update.ribix.dev` is accessible
- Check JSON response format matches expected schema
- Verify SSL certificate is valid

**Issue:** Update download fails
- Verify download URL is correct and accessible
- Check file permissions on download directory
- Verify checksum matches expected value

---

## Blockers & Missing Requirements

### Current Blockers

1. **Code Signing Certificates:**
   - Apple Developer Certificate not yet acquired
   - Windows Authenticode certificate not yet acquired
   - **Impact:** Cannot distribute signed builds to alpha users
   - **Action Required:** Acquire certificates before alpha distribution

2. **Auto-Update Server:**
   - `update.ribix.dev` endpoint not yet configured
   - No infrastructure for hosting update files
   - **Impact:** Auto-update feature will not work
   - **Action Required:** Set up update server infrastructure

3. **Distribution Storage:**
   - No S3 bucket or equivalent for hosting builds
   - No CDN for distributing large files
   - **Impact:** Cannot provide download links to alpha users
   - **Action Required:** Set up storage infrastructure

### Missing Documentation

1. **CI/CD Pipeline:**
   - No automated build pipeline configured
   - No automated signing integration
   - **Action Required:** Set up GitHub Actions or similar CI/CD

2. **Release Process:**
   - No documented release approval process
   - No rollback procedure for bad releases
   - **Action Required:** Document release management workflow

---

## References

- **Engineering Plan:** `Engineering_Plan.md`
- **E2E QA Checklist:** `E2E_QA_Checklist.md`
- **Product Configuration:** `../product.json`
- **Build Scripts:** `../build/`
- **VS Code Build Documentation:** https://github.com/microsoft/vscode/wiki/How-to-Contribute

---

**Document Status:** Phase 15 complete - Documentation ready, awaiting infrastructure setup for actual distribution.