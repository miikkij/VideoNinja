const { app, BrowserWindow, Tray, Menu, shell, nativeImage, ipcMain, dialog } = require('electron');
const path = require('path');
const Store = require('electron-store').default || require('electron-store');
const { checkYtDlpAvailability, getDiskSpace, formatBytes } = require('./ytdlp');
const DownloadQueue = require('./downloadQueue');
const AutoLaunch = require('auto-launch');

const store = new Store();
const downloadQueue = new DownloadQueue();

// Auto-launch configuration
const autoLauncher = new AutoLaunch({
  name: 'VideoNinja',
  path: app.getPath('exe'),
});

let tray = null;
let mainWindow = null;
let animationInterval = null;
let isAnimating = false;
let ytdlpAvailable = false;
let diskSpaceInterval = null;

// Platform-specific icon paths
const ICONS = {
  normal: path.join(__dirname, '../assets/icons/icon-normal.png'),
  alert: path.join(__dirname, '../assets/icons/icon-alert.png'),
  app: path.join(__dirname, '../assets/icons/icon.png'),
};

// Simple base64 encoded 16x16 video camera icon as fallback
const FALLBACK_ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAdgAAAHYBTnsmCAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAD8SURBVDiNpZKxSsNQFIa/e2/SQhFE6OLg4uDm5OQDuPgAPoCTi6Ogo4uDr+Hm5ODg5uYDuDi4uLg4KIhQpE1yj0OSNk3T2h8u3HP+7z/nP+cKM8YYphGRFWAf2AQ84BF4BU6NMZdN+qrM+Al4BvaAtKa1BqwDW8Ar8DhN2wHegXWgVZPWBs6BDWPMoEndAd6ALWNMWJO2A7wBu8aYcpK2C3wAe8aYapL2E/gE9o0x1STtJ/AJ7BtjxpO0n8AncGCMuZ+k/QJ+AYfGmP4sbRf4Bo6MMf1Z2h5wBxwbY0azTm8f+AaOjTGjhv8icAMcGWPGc7Wd/wN/AO4vTZ5EtF+jAAAAAElFTkSuQmCC';
const FALLBACK_ICON_ALERT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAdgAAAHYBTnsmCAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAEOSURBVDiNpZKxSsNQGIW/f25SKIIoOLg4uDm5+QAuPoCTo6ODiIOLg6/h5uTg4ObmA7g4uLi4OCiIUKRNcq9DkjZNa9sfLtxz/vN/5/znCjPGGOYRkXVgD9gCPOANeAFOjTFXbfq6zPgJeAZ2ga2WthqwBmwDL8DTNK0DfAAbwFpLWws4BzaMMfdtek7wAWwaY9KWthP4BLaNMUlL2wl8ATvGmGKS5gLfwK4xZjhJ8z6B38CeMWY0SfMOgN/AvjFmPEnzDoBfwIEx5mGS5h0Cv4B9Y8xwluYB18ChMWYwS9sDroFDY8xg1unjA9fAoTGmP+f09oAb4NAY05/zXwRugENjTH+utvd/4A/vMlJRb7FqfwAAAABJRU5ErkJggg==';

// Check if custom icons exist
const fs = require('fs');
const usePngIcons = fs.existsSync(ICONS.normal) && fs.existsSync(ICONS.alert);

/**
 * Create system tray icon
 */
function createTray() {
  let icon;
  
  if (usePngIcons) {
    icon = nativeImage.createFromPath(ICONS.normal);
  } else {
    // Using fallback icons (add your custom icons to src/assets/icons/)
    icon = nativeImage.createFromDataURL(FALLBACK_ICON);
  }
  
  if (process.platform === 'darwin') {
    icon = icon.resize({ width: 22, height: 22 });
  } else {
    icon = icon.resize({ width: 16, height: 16 });
  }
  
  tray = new Tray(icon);
  tray.setToolTip('VideoNinja - YouTube Downloader');
  
  // Click to show main window
  tray.on('click', () => {
    stopAnimation();
    showMainWindow();
  });
  
  // Right-click for context menu
  tray.on('right-click', () => {
    showContextMenu();
  });
}

/**
 * Show context menu on tray icon
 */
function showContextMenu() {
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open VideoNinja',
      click: () => {
        stopAnimation();
        showMainWindow();
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      }
    }
  ]);
  
  tray.popUpContextMenu(contextMenu);
}

/**
 * Show main application window
 */
async function showMainWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  
  // Get saved window position or use defaults
  const windowBounds = store.get('windowBounds', {
    width: 800,
    height: 700,
    x: undefined,
    y: undefined
  });
  
  mainWindow = new BrowserWindow({
    width: windowBounds.width,
    height: windowBounds.height,
    x: windowBounds.x,
    y: windowBounds.y,
    show: false,
    frame: false,
    resizable: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    icon: ICONS.app
  });
  
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  
  mainWindow.on('close', (e) => {
    // Save window position
    store.set('windowBounds', mainWindow.getBounds());
    // Don't actually close, just hide
    e.preventDefault();
    mainWindow.hide();
  });
  
  // Wait for page to load, then send initial data
  mainWindow.webContents.once('did-finish-load', async () => {
    try {
      console.log('Window loaded, checking yt-dlp availability...');
      const ytdlpInfo = await checkYtDlpAvailability();
      ytdlpAvailable = ytdlpInfo.available;
      
      mainWindow.webContents.send('ytdlp-status', ytdlpInfo);
      
      // Load saved settings
      const settings = store.get('settings', {});
      mainWindow.webContents.send('settings-loaded', settings);
      
      // Load saved queue state
      const queueState = store.get('queueState');
      if (queueState) {
        downloadQueue.loadState(queueState);
      }
      
      // Send initial queue state
      mainWindow.webContents.send('queue-updated', downloadQueue.getQueueState());
      
      // Start disk space monitoring if download path is set
      if (settings.downloadPath) {
        startDiskSpaceMonitoring(settings.downloadPath);
      }
      
      // Send startup status
      autoLauncher.isEnabled().then(isEnabled => {
        mainWindow.webContents.send('startup-status', isEnabled);
      }).catch(err => {
        console.error('Error checking startup status:', err);
      });
      
    } catch (error) {
      console.error('Failed to initialize:', error);
    }
  });
  
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
}

/**
 * Start tray icon flashing animation
 */
function startAnimation() {
  if (isAnimating) return;
  
  isAnimating = true;
  let showAlert = false;
  
  animationInterval = setInterval(() => {
    let icon;
    
    if (usePngIcons) {
      const iconPath = showAlert ? ICONS.alert : ICONS.normal;
      icon = nativeImage.createFromPath(iconPath);
    } else {
      const iconData = showAlert ? FALLBACK_ICON_ALERT : FALLBACK_ICON;
      icon = nativeImage.createFromDataURL(iconData);
    }
    
    if (process.platform === 'darwin') {
      icon = icon.resize({ width: 22, height: 22 });
    } else {
      icon = icon.resize({ width: 16, height: 16 });
    }
    
    tray.setImage(icon);
    showAlert = !showAlert;
  }, 750); // 0.75 seconds
}

/**
 * Stop tray icon animation
 */
function stopAnimation() {
  if (animationInterval) {
    clearInterval(animationInterval);
    animationInterval = null;
  }
  
  isAnimating = false;
  
  let icon;
  if (usePngIcons) {
    icon = nativeImage.createFromPath(ICONS.normal);
  } else {
    icon = nativeImage.createFromDataURL(FALLBACK_ICON);
  }
  
  if (process.platform === 'darwin') {
    icon = icon.resize({ width: 22, height: 22 });
  } else {
    icon = icon.resize({ width: 16, height: 16 });
  }
  
  tray.setImage(icon);
}

/**
 * Start monitoring disk space
 */
function startDiskSpaceMonitoring(downloadPath) {
  stopDiskSpaceMonitoring();
  
  const checkDiskSpace = async () => {
    try {
      const diskSpace = await getDiskSpace(downloadPath);
      
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('disk-space-updated', {
          total: diskSpace.total,
          free: diskSpace.free,
          used: diskSpace.used,
          freeFormatted: formatBytes(diskSpace.free),
          totalFormatted: formatBytes(diskSpace.total)
        });
        
        // Warn if less than 5GB
        const fiveGB = 5 * 1024 * 1024 * 1024;
        const oneGB = 1 * 1024 * 1024 * 1024;
        
        if (diskSpace.free < oneGB) {
          mainWindow.webContents.send('disk-space-critical', {
            free: diskSpace.free,
            freeFormatted: formatBytes(diskSpace.free)
          });
        } else if (diskSpace.free < fiveGB) {
          mainWindow.webContents.send('disk-space-low', {
            free: diskSpace.free,
            freeFormatted: formatBytes(diskSpace.free)
          });
        }
      }
    } catch (error) {
      console.error('Error checking disk space:', error);
    }
  };
  
  // Check immediately
  checkDiskSpace();
  
  // Check every 30 seconds
  diskSpaceInterval = setInterval(checkDiskSpace, 30000);
}

/**
 * Stop disk space monitoring
 */
function stopDiskSpaceMonitoring() {
  if (diskSpaceInterval) {
    clearInterval(diskSpaceInterval);
    diskSpaceInterval = null;
  }
}

// ===== IPC HANDLERS =====

/**
 * Save settings
 */
ipcMain.on('save-settings', (event, settings) => {
  store.set('settings', settings);
  
  // Start/update disk space monitoring if download path changed
  if (settings.downloadPath) {
    startDiskSpaceMonitoring(settings.downloadPath);
  }
  
  event.reply('settings-saved', true);
});

/**
 * Choose download directory
 */
ipcMain.handle('choose-download-directory', async (event) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory']
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  
  return null;
});

/**
 * Add download to queue
 */
ipcMain.on('add-download', (event, { url, outputPath, options }) => {
  const downloadId = downloadQueue.addDownload(url, outputPath, options);
  event.reply('download-added', downloadId);
});

/**
 * Cancel download
 */
ipcMain.on('cancel-download', (event, downloadId) => {
  const success = downloadQueue.cancelDownload(downloadId);
  event.reply('download-cancelled', { id: downloadId, success });
});

/**
 * Retry download
 */
ipcMain.on('retry-download', (event, downloadId) => {
  const newId = downloadQueue.retryDownload(downloadId);
  event.reply('download-retried', { oldId: downloadId, newId });
});

/**
 * Open downloaded video
 */
ipcMain.on('open-video', (event, filepath) => {
  shell.openPath(filepath);
});

/**
 * Show video in folder
 */
ipcMain.on('show-in-folder', (event, filepath) => {
  shell.showItemInFolder(filepath);
});

/**
 * Hide window to tray
 */
ipcMain.on('hide-window', (event) => {
  if (mainWindow) {
    mainWindow.hide();
  }
});

// ===== DOWNLOAD QUEUE EVENTS =====

downloadQueue.on('queue-updated', (state) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('queue-updated', state);
  }
  
  // Save queue state
  store.set('queueState', downloadQueue.getStateForSave());
});

downloadQueue.on('download-started', (download) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('download-started', download);
  }
  
  // Start flashing animation when download starts
  startAnimation();
});

downloadQueue.on('download-progress', (progress) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('download-progress', progress);
  }
});

downloadQueue.on('download-completed', (download) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('download-completed', download);
  }
  
  // Stop animation when download completes
  stopAnimation();
});

downloadQueue.on('download-failed', (download) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('download-failed', download);
  }
  
  // Stop animation if download fails
  stopAnimation();
});

// ===== APP LIFECYCLE =====

app.whenReady().then(async () => {
  createTray();
  
  // Check for yt-dlp availability
  const ytdlpInfo = await checkYtDlpAvailability();
  ytdlpAvailable = ytdlpInfo.available;
  console.log('yt-dlp available:', ytdlpAvailable);
  
  // Show main window on first launch
  showMainWindow();
});

app.on('window-all-closed', (e) => {
  // Prevent app from quitting when window is closed (keep in tray)
  // Comment out the next line if you want app to quit when window closes
  e.preventDefault();
});

app.on('before-quit', () => {
  if (animationInterval) {
    clearInterval(animationInterval);
  }
  stopDiskSpaceMonitoring();
  
  // Actually close the window when quitting
  if (mainWindow) {
    mainWindow.destroy();
    mainWindow = null;
  }
});

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      mainWindow.focus();
    } else {
      showMainWindow();
    }
  });
}
