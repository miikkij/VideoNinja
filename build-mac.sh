#!/bin/bash

# Fatalii Daily Offers - Mac Build Script
# Run this on a Mac to build the .dmg installer

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║     Fatalii's Daily Offers - Mac Build Script               ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Check if we're on macOS
if [[ "$OSTYPE" != "darwin"* ]]; then
    echo "⚠️  This script must be run on macOS"
    echo ""
    echo "To build for Mac:"
    echo "1. Copy this project folder to a Mac"
    echo "2. Open Terminal in the project folder"
    echo "3. Run: chmod +x build-mac.sh"
    echo "4. Run: ./build-mac.sh"
    exit 1
fi

echo "✓ Running on macOS"
echo ""

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found"
    echo "Please install Node.js from https://nodejs.org"
    exit 1
fi

echo "✓ Node.js found: $(node --version)"
echo ""

# Check for pnpm
if ! command -v pnpm &> /dev/null; then
    echo "⚠️  pnpm not found, installing..."
    npm install -g pnpm
fi

echo "✓ pnpm found: $(pnpm --version)"
echo ""

# Install dependencies
echo "📦 Installing dependencies..."
pnpm install

echo ""
echo "🔨 Building Mac application..."
pnpm build:mac

echo ""
echo "✅ Build complete!"
echo ""
echo "Your Mac installer is ready:"
ls -lh dist/*.dmg 2>/dev/null || echo "⚠️  No .dmg file found in dist/"
ls -lh dist/*.zip 2>/dev/null || echo "⚠️  No .zip file found in dist/"
echo ""
echo "The app is ready to distribute!"
