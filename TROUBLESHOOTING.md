# Ribix IDE Troubleshooting Guide

This guide helps you diagnose and resolve common issues with the Ribix IDE.

## Table of Contents

- [Installation Issues](#installation-issues)
- [Build Issues](#build-issues)
- [Runtime Issues](#runtime-issues)
- [Agent Issues](#agent-issues)
- [Browser Tool Issues](#browser-tool-issues)
- [Performance Issues](#performance-issues)
- [Platform-Specific Issues](#platform-specific-issues)

## Installation Issues

### Problem: Build fails with "Compilation error"

**Solution:**
```bash
# Ensure Node.js version is exactly 20.18.2
nvm use 20.18.2
node --version

# Clear build artifacts
rm -rf out dist

# Install dependencies
npm install

# Build React components first
npm run buildreact

# Then compile TypeScript
npm run compile
```

### Problem: "Module not found" errors during build

**Solution:**
```bash
# Clean install dependencies
rm -rf node_modules
npm install

# Check for missing dependencies in package.json
# Verify all imports are correct
# Check for circular dependencies

# Rebuild from scratch
npm run compile
```

### Problem: Build takes too long (8-10 minutes)

**Solution:**
```bash
# This is normal for first-time build
# Subsequent builds will be faster

# Use watch mode for development
npm run watch

# Increase Node.js memory limit
NODE_OPTIONS="--max-old-space-size=8192" npm run compile
```

### Problem: Platform-specific build failures

**Solution:**

**Linux:**
```bash
# Install build dependencies
sudo apt-get install -y build-essential g++ libx11-dev \
  libxkbfile-dev libsecret-1-dev libkrb5-dev python-is-python3
```

**macOS:**
```bash
# Install Xcode command line tools
xcode-select --install

# Install required dependencies
brew install python
```

**Windows:**
```bash
# Ensure Visual Studio Build Tools are installed
# Install Windows SDK
# Use provided install.bat instead of install.sh
```

## Build Issues

### Problem: React component build fails

**Solution:**
```bash
# Navigate to React directory
cd src/vs/workbench/contrib/ribix/browser/react/

# Build React components manually
node build.js

# Check for React-specific errors
# Verify React dependencies are installed
# Check for JSX/TypeScript errors
```

### Problem: TypeScript compilation errors

**Solution:**
```bash
# Check TypeScript version
npm list typescript

# Verify tsconfig.json settings
# Check for strict mode violations
# Fix type errors incrementally

# Use specific compilation targets
npm run compile-cli
npm run compile-web
```

### Problem: Gulp build failures

**Solution:**
```bash
# Check gulp installation
npm list gulp

# Run gulp with verbose output
npm run gulp --verbose

# Check gulpfile.js for errors
# Verify all gulp plugins are installed
```

## Runtime Issues

### Problem: IDE won't launch

**Solution:**
```bash
# Download Electron first
node build/lib/preLaunch.js

# Launch with debug logging
./scripts/code.sh --user-data-dir ./.tmp/user-data \
  --extensions-dir ./.tmp/extensions --log trace

# Check for error messages in terminal
```

### Problem: "Command Center not found" error

**Solution:**
```bash
# Verify Ribix-specific files exist
ls src/vs/workbench/contrib/ribix/browser/ribix*

# Check if extension is properly loaded
# Look for "ribix" in logs

# Ensure build completed successfully
npm run compile
node build/lib/preLaunch.js
```

### Problem: Agent services not starting

**Solution:**
```bash
# Check agent service files exist
ls src/vs/workbench/contrib/ribix/browser/ribixAgentService*

# Verify agent configuration
# Check LLM API key is set in Command Center
# Ensure required dependencies are installed

# Check logs for agent initialization errors
# Look for service registration failures
```

### Problem: Extension loading failures

**Solution:**
```bash
# Check extensions directory
ls ./.tmp/extensions

# Verify builtin extensions are downloaded
npm run download-builtin-extensions

# Check extension compatibility
# Look for extension version conflicts
```

## Agent Issues

### Problem: Agents not executing missions

**Solution:**
```bash
# Check LLM API key is configured
# Open Command Center → Settings → API Keys
# Verify API key is valid for chosen provider

# Test agent connection
# Create simple test mission
# Monitor agent logs in Command Center

# Check agent service status
# Look for agent initialization errors
# Verify all agent dependencies are loaded
```

### Problem: Agent gets stuck in planning phase

**Solution:**
```bash
# Check LLM API rate limits
# Verify API quota is not exceeded
# Test API key validity

# Increase timeout settings
# Check planning service configuration
# Look for infinite loops in planning logic

# Restart agent service
# Reload IDE window
```

### Problem: Multi-agent coordination failures

**Solution:**
```bash
# Check orchestration service
# Verify agent communication channels
# Look for message passing failures

# Check agent dependency resolution
# Verify file locking mechanisms
# Look for deadlock situations

# Monitor agent states in Command Center
# Check for stuck agents
# Kill stuck agents if necessary
```

### Problem: Agent memory not persisting

**Solution:**
```bash
# Check memory service configuration
# Verify storage backend is accessible
# Check workspace storage permissions

# Test memory persistence manually
# Create test mission
# Check if memory is saved across sessions

# Verify memory service is running
# Check for storage errors in logs
```

## Browser Tool Issues

### Problem: Playwright browser not launching

**Solution:**
```bash
# Install Playwright browsers
npx playwright install

# Verify browser installation
npx playwright install --help

# Check browser channel configuration
# Verify browser executable paths
```

### Problem: Browser automation failures

**Solution:**
```bash
# Test Playwright manually
npx playwright codegen https://example.com

# Check browser tool configuration
# Verify browser channel is accessible
# Look for browser launch errors

# Check system dependencies
# Ensure required libraries are installed
```

### Problem: Screenshots not capturing

**Solution:**
```bash
# Check screenshot directory permissions
# Verify screenshot save path
# Test screenshot capture manually

# Check browser context configuration
# Verify viewport settings
# Look for capture errors in logs
```

### Problem: Browser tool crashes

**Solution:**
```bash
# Check system resources
# Monitor memory usage
# Check for browser memory leaks

# Restart browser tool
# Clear browser cache
# Reduce concurrent browser instances
```

## Performance Issues

### Problem: IDE is slow to start

**Solution:**
```bash
# This is normal for VS Code-based IDEs
# Consider using faster SSD storage
# Increase system RAM if possible

# Disable unnecessary extensions
# Minimize number of opened workspaces
# Use lightweight workspace
```

### Problem: High memory usage

**Solution:**
```bash
# Monitor memory usage
# Check for memory leaks in agent services
# Verify proper cleanup in error handlers

# Increase Node.js memory limit
NODE_OPTIONS="--max-old-space-size=8192" ./scripts/code.sh

# Close unused panels
# Minimize number of active agents
```

### Problem: Agent execution is slow

**Solution:**
```bash
# Check LLM API response times
# Consider using faster models
# Implement response caching

# Optimize agent prompts
# Reduce context window size
# Use streaming responses where possible

# Check system resources
# Ensure sufficient CPU and RAM
```

### Problem: UI responsiveness issues

**Solution:**
```bash
# Check for blocking operations on main thread
# Offload heavy computation to worker threads
# Implement proper async/await patterns

# Reduce number of UI updates
# Implement debouncing/throttling
# Use virtual scrolling for large lists
```

## Platform-Specific Issues

### Linux-Specific Issues

**Problem: Missing system libraries**

```bash
# Install all required dependencies
sudo apt-get install -y build-essential g++ libx11-dev \
  libxkbfile-dev libsecret-1-dev libkrb5-dev python-is-python3 \
  libnss3-dev libxss1-dev libasound2-dev libxtst6-dev

# Install additional libraries if needed
sudo apt-get install -y libgconf-2-4 libudev-dev libgbm-dev
```

**Problem: Permission denied errors**

```bash
# Fix script permissions
chmod +x scripts/code.sh
chmod +x scripts/code.bat

# Run as regular user (not root)
# Check file ownership
```

### macOS-Specific Issues

**Problem: Code signing errors**

```bash
# This may occur on macOS with Gatekeeper
# Temporarily disable Gatekeeper for testing
sudo spctl --master-disable

# Or add exception for the app
xattr -cr /path/to/Ribix.app
```

**Problem: Display issues**

```bash
# Ensure you're in a graphical session
# Check display server is running
echo $DISPLAY

# Try launching from Terminal
# Avoid launching from SSH without X forwarding
```

### Windows-Specific Issues

**Problem: Path length issues**

```bash
# Windows has 260 character path limit
# Move project closer to drive root
# Use subst to map drive letters
subst R: "C:\long\path\to\ribix-ide"
cd R:
```

**Problem: PowerShell execution policy**

```bash
# Set execution policy to allow scripts
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# Or run PowerShell as Administrator
# Use install.bat instead of install.sh
```

**Problem: Build tools not found**

```bash
# Install Visual Studio Build Tools
# Download from: https://visualstudio.microsoft.com/downloads/

# Install Windows SDK
# Ensure C++ build tools are selected

# Add MSBuild to PATH
# Verify build tools are accessible
```

## Debug Mode

Enable comprehensive debugging:

```bash
# Launch with verbose logging
./scripts/code.sh --user-data-dir ./.tmp/user-data \
  --extensions-dir ./.tmp/extensions --log trace --verbose

# Enable Node.js debugging
NODE_OPTIONS="--inspect" ./scripts/code.sh

# Connect Chrome DevTools to localhost:9229
# Set breakpoints in agent services
# Step through agent execution
```

## Development Workflow

### Making Changes

```bash
# 1. Make source code changes
# 2. Build React components if needed
npm run buildreact

# 3. Compile TypeScript
npm run compile

# 4. Download Electron if needed
node build/lib/preLaunch.js

# 5. Launch IDE
./scripts/code.sh --user-data-dir ./.tmp/user-data \
  --extensions-dir ./.tmp/extensions
```

### Watch Mode

```bash
# Use watch mode for faster iteration
npm run watch

# Or watch specific components
npm run watch-client
npm run watch-extensions
```

### Testing

```bash
# Run unit tests
npm test

# Run browser tests
npm run test-browser

# Run extension tests
npm run test-extension
```

## Common Error Messages

| Error | Cause | Solution |
|-------|-------|----------|
| `Module not found` | Missing dependency | Run `npm install` |
| `Compilation error` | TypeScript error | Fix type errors, rebuild |
| `Command Center not found` | Missing Ribix files | Verify build completed |
| `Agent service error` | LLM API issue | Check API key, quota |
| `Browser launch failed` | Playwright issue | Install browsers, check deps |
| `Out of memory` | Memory leak | Increase memory limit, restart |
| `Permission denied` | File permissions | Fix permissions, use correct user |

## Getting Help

If you're still experiencing issues:

1. **Check the logs**: Terminal output, Command Center logs
2. **Verify your setup**: Ensure Node.js 20.18.2, build dependencies
3. **Report the issue**: Include error messages, platform info, reproduction steps
4. **Community support**: Check GitHub Issues for similar problems

### Useful Diagnostic Commands

```bash
# Check Node version
node --version  # Should be 20.18.2

# Verify dependencies
npm list

# Build React components
npm run buildreact

# Compile TypeScript
npm run compile

# Download Electron
node build/lib/preLaunch.js

# Launch with debugging
./scripts/code.sh --user-data-dir ./.tmp/user-data \
  --extensions-dir ./.tmp/extensions --log trace

# Run tests
npm test
```

## System Requirements

- **Node.js**: 20.18.2 (exact version required)
- **RAM**: 8GB minimum, 16GB recommended
- **Storage**: 10GB free space
- **OS**: macOS 10.15+, Windows 10+, Linux (Ubuntu 20.04+)

## Known Limitations

- **Build time**: First build takes 8-10 minutes
- **Resource usage**: High CPU and RAM usage
- **Platform support**: Limited to major platforms
- **Updates**: Manual rebuild required for updates
- **Extensions**: Limited VS Code extension compatibility

## Additional Resources

- [Main Documentation](README.md)
- [Architecture Documentation](docs/architecture.md)
- [Contribution Guidelines](HOW_TO_CONTRIBUTE.md)
- [GitHub Issues](https://github.com/ch1kim0n1/ribix-ide/issues)
- [Community Discord](https://discord.gg/ribix)

## Uninstallation

```bash
# Remove build artifacts
rm -rf out dist node_modules

# Remove user data
rm -rf ./.tmp/user-data

# Remove extensions
rm -rf ./.tmp/extensions

# Remove globally installed packages (if any)
npm uninstall -g ribix-ide
```