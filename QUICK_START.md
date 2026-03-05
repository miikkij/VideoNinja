# 🚀 VideoNinja - Quick Start Guide

## Prerequisites

VideoNinja needs **yt-dlp** (required) and **ffmpeg** (recommended for best quality).

### Windows

**Easiest** — install both with [Chocolatey](https://chocolatey.org/):

```powershell
choco install yt-dlp ffmpeg -y
```

**Manual install:**
1. Download `yt-dlp.exe` from [yt-dlp releases](https://github.com/yt-dlp/yt-dlp/releases)
2. Download ffmpeg from [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) (essentials build)
3. Place both in the same folder as VideoNinja, or any folder in your PATH

### macOS

```bash
brew install yt-dlp ffmpeg
```

---

## Running VideoNinja

### 1. Install Dependencies

```bash
pnpm install
```

If you don't have pnpm installed:

```bash
npm install -g pnpm
```

### 2. Start the App

```bash
pnpm start
```

### 3. First Launch

1. The app will check if yt-dlp is installed
2. If found, you'll see the Settings panel
3. Click **"📁 Choose"** to select where to save videos
4. Once set, the download panel will appear

### 4. Download Your First Video

1. Paste a YouTube URL in the text box
2. Select quality (optional - defaults to best)
3. Click **"⬇️ Start Download"**
4. Watch the progress in the Downloads list!

---

## Building for Distribution

### Windows

```bash
pnpm run build:win
```

Output will be in the `dist/` folder:
- `.exe` installer
- Portable version

### macOS

```bash
pnpm run build:mac
```

---

## Troubleshooting

### yt-dlp Not Found

**Problem:** App shows "yt-dlp Not Found" screen

**Solutions:**
1. Make sure yt-dlp.exe is installed
2. Try placing it in the same folder as VideoNinja
3. Restart the app after installing yt-dlp

### Download Fails

**Problem:** Video download shows red X

**Solutions:**
1. Check your internet connection
2. Verify the YouTube URL is correct
3. Try a different quality setting
4. Click the 🔄 retry button

### No Disk Space Warning

**Problem:** Getting disk space warnings

**Solutions:**
1. Free up space on your download drive
2. Change download folder to a drive with more space
3. Delete old downloads

---

## Tips & Tricks

### Multiple Downloads
- You can queue multiple videos
- They download one at a time automatically
- Queue persists if you close the app

### Quality Selection
- **Best Quality** - Automatically selects the highest quality
- **4K/1080p/720p** - Specific resolutions
- **Audio Only** - Downloads just the audio track

### Keyboard Shortcuts
- Copy URL with `Ctrl+C` / `Cmd+C`
- Paste with `Ctrl+V` / `Cmd+V`
- Start download with `Enter` (when URL field is focused)

### System Tray
- App minimizes to system tray
- Icon flashes when downloads complete
- Right-click for quick menu

---

**Happy Downloading! 🎬**
