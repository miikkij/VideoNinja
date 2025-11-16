const { app, BrowserWindow, Tray, Menu, shell, nativeImage } = require('electron');
const path = require('path');
const Store = require('electron-store').default || require('electron-store');
const { fetchDailyOffers } = require('./scraper');

const store = new Store();
let tray = null;
let mainWindow = null;
let animationInterval = null;
let isAnimating = false;

// Platform-specific icon paths
const ICONS = {
  normal: path.join(__dirname, '../assets/icons/chili.png'),
  alert: path.join(__dirname, '../assets/icons/chili-alert.png'),
  normalSvg: path.join(__dirname, '../assets/icons/chili.svg'),
  alertSvg: path.join(__dirname, '../assets/icons/chili-alert.svg')
};

// Simple base64 encoded 16x16 red circle icon as fallback
const FALLBACK_ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAdgAAAHYBTnsmCAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAD8SURBVDiNpZKxSsNQFIa/e2/SQhFE6OLg4uDm5OQDuPgAPoCTi6Ogo4uDr+Hm5ODg5uYDuDi4uLg4KIhQpE1yj0OSNk3T2h8u3HP+7z/nP+cKM8YYphGRFWAf2AQ84BF4BU6NMZdN+qrM+Al4BvaAtKa1BqwDW8Ar8DhN2wHegXWgVZPWBs6BDWPMoEndAd6ALWNMWJO2A7wBu8aYcpK2C3wAe8aYapL2E/gE9o0x1STtJ/AJ7BtjxpO0n8AncGCMuZ+k/QJ+AYfGmP4sbRf4Bo6MMf1Z2h5wBxwbY0azTm8f+AaOjTGjhv8icAMcGWPGc7Wd/wN/AO4vTZ5EtF+jAAAAAElFTkSuQmCC';
const FALLBACK_ICON_ALERT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAdgAAAHYBTnsmCAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAEOSURBVDiNpZKxSsNQGIW/f25SKIIoOLg4uDk5+QAuPoCTo6ODiIOLg6/h5uTg4ObmA7g4uLi4OCiIUKRNcq9DkjZNa9sfLtxz/vN/5/znCjPGGOYRkXVgD9gCPOANeAFOjTFXbfq6zPgJeAZ2ga2WthqwBmwDL8DTNK0DfAAbwFpLWws4BzaMMfdtek7wAWwaY9KWthP4BLaNMUlL2wl8ATvGmGKS5gLfwK4xZjhJ8z6B38CeMWY0SfMOgN/AvjFmPEnzDoBfwIEx5mGS5h0Cv4B9Y8xwluYB18ChMWYwS9sDroFDY8xg1unjA9fAoTGmP+f09oAb4NAY05/zXwRugENjTH+utvd/4A/vMlJRb7FqfwAAAABJRU5ErkJggg==';

// Check if custom icons exist
const fs = require('fs');
const usePngIcons = fs.existsSync(ICONS.normal) && fs.existsSync(ICONS.alert);
const useSvgIcons = !usePngIcons && fs.existsSync(ICONS.normalSvg) && fs.existsSync(ICONS.alertSvg);

function createTray() {
  // Create tray icon
  let icon;
  
  if (usePngIcons) {
    icon = nativeImage.createFromPath(ICONS.normal);
  } else if (useSvgIcons) {
    // Load SVG and convert to image
    const svgBuffer = fs.readFileSync(ICONS.normalSvg);
    icon = nativeImage.createFromBuffer(svgBuffer);
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
  tray.setToolTip('Fatalii\'s Daily Offers');
  
  // Click to show offers window
  tray.on('click', () => {
    stopAnimation();
    showOffersWindow();
  });
  
  // Right-click for context menu
  tray.on('right-click', () => {
    showContextMenu();
  });
}

function showContextMenu() {
  const isStartAtLogin = app.getLoginItemSettings().openAtLogin;
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Start at Login',
      type: 'checkbox',
      checked: isStartAtLogin,
      click: (menuItem) => {
        app.setLoginItemSettings({
          openAtLogin: menuItem.checked,
          openAsHidden: true
        });
      }
    },
    { type: 'separator' },
    {
      label: 'Refresh Offers',
      click: async () => {
        await checkForNewOffers(true);
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

async function showOffersWindow() {
  if (mainWindow) {
    mainWindow.focus();
    return;
  }
  
  mainWindow = new BrowserWindow({
    width: 500,
    height: 700,
    show: false,
    frame: false,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  
  // Wait for page to load, then fetch and send offers
  mainWindow.webContents.once('did-finish-load', async () => {
    try {
      console.log('Window loaded, fetching offers...');
      const offers = await fetchDailyOffers();
      console.log('Sending offers to renderer:', offers.length);
      mainWindow.webContents.send('offers-data', offers);
    } catch (error) {
      console.error('Failed to fetch offers:', error);
      mainWindow.webContents.send('offers-data', []);
    }
  });
  
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    positionWindowNearTray();
  });
}

function positionWindowNearTray() {
  if (!mainWindow || !tray) return;
  
  const trayBounds = tray.getBounds();
  const windowBounds = mainWindow.getBounds();
  
  // Position window near tray icon
  const x = Math.round(trayBounds.x - windowBounds.width / 2 + trayBounds.width / 2);
  const y = process.platform === 'darwin' ? trayBounds.y + trayBounds.height : trayBounds.y - windowBounds.height;
  
  mainWindow.setPosition(x, y);
}

function startAnimation() {
  if (isAnimating) return;
  
  isAnimating = true;
  let showAlert = false;
  
  animationInterval = setInterval(() => {
    let icon;
    
    if (usePngIcons) {
      const iconPath = showAlert ? ICONS.alert : ICONS.normal;
      icon = nativeImage.createFromPath(iconPath);
    } else if (useSvgIcons) {
      const svgPath = showAlert ? ICONS.alertSvg : ICONS.normalSvg;
      const svgBuffer = fs.readFileSync(svgPath);
      icon = nativeImage.createFromBuffer(svgBuffer);
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

function stopAnimation() {
  if (animationInterval) {
    clearInterval(animationInterval);
    animationInterval = null;
  }
  
  isAnimating = false;
  
  let icon;
  if (usePngIcons) {
    icon = nativeImage.createFromPath(ICONS.normal);
  } else if (useSvgIcons) {
    const svgBuffer = fs.readFileSync(ICONS.normalSvg);
    icon = nativeImage.createFromBuffer(svgBuffer);
  } else {
    icon = nativeImage.createFromDataURL(FALLBACK_ICON);
  }
  
  if (process.platform === 'darwin') {
    icon = icon.resize({ width: 22, height: 22 });
  } else {
    icon = icon.resize({ width: 16, height: 16 });
  }
  
  tray.setImage(icon);
  
  // Mark as seen
  const today = new Date().toDateString();
  store.set('lastSeenDate', today);
}

async function checkForNewOffers(force = false) {
  const today = new Date().toDateString();
  const lastSeenDate = store.get('lastSeenDate');
  const lastCheckDate = store.get('lastCheckDate');
  
  // Only fetch if not checked today or forced
  if (!force && lastCheckDate === today) {
    // Check if user has seen today's offers
    if (lastSeenDate !== today) {
      startAnimation();
    }
    return;
  }
  
  try {
    const offers = await fetchDailyOffers();
    
    if (offers && offers.length > 0) {
      store.set('lastCheckDate', today);
      store.set('currentOffers', offers);
      
      // Start animation if user hasn't seen today's offers
      if (lastSeenDate !== today) {
        startAnimation();
      }
    }
  } catch (error) {
    console.error('Failed to check for new offers:', error);
  }
}

function scheduleNextCheck() {
  const now = new Date();
  const next6AM = new Date();
  next6AM.setHours(6, 0, 0, 0);
  
  // If it's past 6 AM today, schedule for 6 AM tomorrow
  if (now >= next6AM) {
    next6AM.setDate(next6AM.getDate() + 1);
  }
  
  const msUntil6AM = next6AM - now;
  
  setTimeout(() => {
    checkForNewOffers();
    // Schedule next day
    setInterval(() => {
      checkForNewOffers();
    }, 24 * 60 * 60 * 1000); // Every 24 hours
  }, msUntil6AM);
  
  console.log(`Next check scheduled for: ${next6AM.toLocaleString()}`);
}

// Handle add to cart from renderer
const { ipcMain } = require('electron');

ipcMain.on('add-to-cart', (event, productUrl) => {
  shell.openExternal(productUrl);
});

ipcMain.on('add-all-to-cart', (event, products) => {
  // Open all product pages with add-to-cart parameter
  products.forEach((product, index) => {
    setTimeout(() => {
      shell.openExternal(product.addToCartUrl);
    }, index * 500); // Stagger by 500ms to avoid browser issues
  });
});

// App lifecycle
app.whenReady().then(async () => {
  createTray();
  
  // Check for offers on startup
  await checkForNewOffers();
  
  // Schedule daily checks at 6 AM
  scheduleNextCheck();
});

app.on('window-all-closed', (e) => {
  // Prevent app from quitting when window is closed
  e.preventDefault();
});

app.on('before-quit', () => {
  if (animationInterval) {
    clearInterval(animationInterval);
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
      showOffersWindow();
    }
  });
}
