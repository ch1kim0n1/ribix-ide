#!/bin/bash

# Ribix IDE One-Click Installer for Linux/macOS

set -e

echo "🚀 Ribix IDE One-Click Installer"
echo "=================================="

# Check Node.js version
echo "📋 Checking Node.js version..."
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed"
    echo "Please install Node.js 20.18.2 from https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v)
REQUIRED_VERSION="v20.18.2"

echo "Found Node.js version: $NODE_VERSION"
if [ "$NODE_VERSION" != "$REQUIRED_VERSION" ]; then
    echo "⚠️  Warning: Node.js version $REQUIRED_VERSION is recommended"
    echo "Current version: $NODE_VERSION"
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Install build dependencies (Linux only)
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    echo "📦 Installing build dependencies..."
    if command -v apt-get &> /dev/null; then
        sudo apt-get update
        sudo apt-get install -y build-essential g++ libx11-dev libxkbfile-dev libsecret-1-dev libkrb5-dev python-is-python3
    elif command -v yum &> /dev/null; then
        sudo yum groupinstall -y "Development Tools"
        sudo yum install -y libX11-devel libxkbfile-devel libsecret-devel krb5-devel python3
    else
        echo "⚠️  Unsupported package manager. Please install build dependencies manually."
    fi
fi

# Clone or update repository
echo "📥 Getting Ribix IDE..."
if [ -d "ribix-ide" ]; then
    echo "Updating existing installation..."
    cd ribix-ide
    git pull
else
    echo "Cloning repository..."
    git clone https://github.com/ch1kim0n1/ribix-ide.git
    cd ribix-ide
fi

# Install dependencies
echo "📦 Installing dependencies..."
nvm use 20.18.2 || echo "Using system Node.js"
npm ci

# Build React components
echo "🔨 Building React components..."
npm run buildreact

# Compile TypeScript
echo "🔨 Compiling TypeScript (this may take 8-10 minutes)..."
npm run compile

# Download Electron
echo "⬇️  Downloading Electron..."
node build/lib/preLaunch.js

# Create desktop shortcut (Linux)
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    echo "🖥️  Creating desktop shortcut..."
    cat > ~/.local/share/applications/ribix-ide.desktop <<EOF
[Desktop Entry]
Name=Ribix IDE
Comment=Agent-first software engineering OS
Exec=$(pwd)/scripts/code.sh --user-data-dir ~/.ribix-ide/user-data --extensions-dir ~/.ribix-ide/extensions
Icon=$(pwd)/resources/linux/ribix.png
Terminal=false
Type=Application
Categories=Development;IDE;
EOF
    chmod +x ~/.local/share/applications/ribix-ide.desktop
    echo "✅ Desktop shortcut created"
fi

# Create desktop shortcut (macOS)
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "🖥️  Creating application shortcut..."
    osascript -e "tell application \"Finder\" to make alias file POSIX file \"$(pwd)\" to POSIX file \"/Applications\""
    echo "✅ Application alias created in /Applications"
fi

echo ""
echo "✅ Installation complete!"
echo ""
echo "🚀 To launch Ribix IDE:"
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "   Open Ribix IDE from /Applications"
else
    echo "   Run: $PWD/scripts/code.sh --user-data-dir ~/.ribix-ide/user-data --extensions-dir ~/.ribix-ide/extensions"
    echo "   Or use the desktop shortcut"
fi
echo ""
echo "📚 For more information, visit https://github.com/ch1kim0n1/ribix-ide"