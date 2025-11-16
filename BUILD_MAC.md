# Fatalii's Daily Offers - Mac Build Instructions

## Building on Mac

1. **Transfer the project to a Mac:**
   - Copy the entire `fatalii` folder to your Mac
   - Or clone from git if you've pushed it to a repository

2. **Open Terminal:**
   - Navigate to the project folder:
     ```bash
     cd /path/to/fatalii
     ```

3. **Install dependencies:**
   ```bash
   npm install -g pnpm
   pnpm install
   ```

4. **Build the Mac app:**
   ```bash
   pnpm build:mac
   ```

   Or use the build script:
   ```bash
   chmod +x build-mac.sh
   ./build-mac.sh
   ```

5. **Find your installers:**
   - `.dmg` installer: `dist/Fatalii's Daily Offers-1.0.0.dmg`
   - `.zip` archive: `dist/Fatalii's Daily Offers-1.0.0-mac.zip`

## What You Get

- **DMG Installer**: Drag-and-drop installer for easy distribution
- **ZIP Archive**: Portable version that can be extracted anywhere

## Troubleshooting

### Code Signing (Optional)

If you want to distribute outside the App Store, you may need to sign the app:

1. Get an Apple Developer account ($99/year)
2. Create a Developer ID certificate
3. Add to `package.json`:
   ```json
   "mac": {
     "identity": "Your Name (TEAM_ID)"
   }
   ```

For personal use or testing, unsigned builds work fine (users need to right-click → Open on first launch).

### Notarization (Optional)

For wider distribution without security warnings:

1. Sign the app (see above)
2. Add notarization credentials
3. electron-builder handles the rest automatically

For most users, the unsigned build from step 4 is sufficient.

## System Requirements

- **Build Requirements:**
  - macOS 10.13 or later
  - Node.js 16+
  - 500 MB free space

- **Runtime Requirements:**
  - macOS 10.13 or later
  - Internet connection

## File Size

Expect the final packages to be around:
- DMG: ~140-150 MB
- ZIP: ~140 MB

This is normal for Electron apps as they include the entire Chrome browser engine.
