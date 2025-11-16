const { ipcRenderer } = require('electron');
const { shell } = require('electron');

let ytdlpAvailable = false;
let settings = {};
let queueState = {};

// DOM Elements
const loadingEl = document.getElementById('loading');
const ytdlpMissingEl = document.getElementById('ytdlp-missing');
const settingsPanelEl = document.getElementById('settings-panel');
const downloadPanelEl = document.getElementById('download-panel');
const downloadsListEl = document.getElementById('downloads-list');
const downloadsContainerEl = document.getElementById('downloads-container');

const retryYtdlpBtn = document.getElementById('retry-ytdlp');
const chooseFolderBtn = document.getElementById('choose-folder-btn');
const startDownloadBtn = document.getElementById('start-download-btn');

const ytdlpPathInput = document.getElementById('ytdlp-path');
const downloadPathInput = document.getElementById('download-path');
const videoUrlInput = document.getElementById('video-url');
const qualitySelect = document.getElementById('quality-select');
const diskSpaceEl = document.getElementById('disk-space');
const diskSpaceValueEl = document.getElementById('disk-space-value');

// ===== INITIALIZATION =====

// Listen for yt-dlp status
ipcRenderer.on('ytdlp-status', (event, ytdlpInfo) => {
  console.log('yt-dlp status:', ytdlpInfo);
  ytdlpAvailable = ytdlpInfo.available;
  
  loadingEl.style.display = 'none';
  
  if (ytdlpInfo.available) {
    ytdlpPathInput.value = ytdlpInfo.path;
    settingsPanelEl.style.display = 'block';
  } else {
    ytdlpMissingEl.style.display = 'block';
  }
});

// Listen for settings loaded
ipcRenderer.on('settings-loaded', (event, loadedSettings) => {
  console.log('Settings loaded:', loadedSettings);
  settings = loadedSettings;
  
  if (settings.downloadPath) {
    downloadPathInput.value = settings.downloadPath;
    
    // Show download panel
    downloadPanelEl.style.display = 'block';
    downloadsListEl.style.display = 'block';
  }
});

// Listen for queue updates
ipcRenderer.on('queue-updated', (event, state) => {
  console.log('Queue updated:', state);
  queueState = state;
  updateDownloadsList();
});

// Listen for download progress
ipcRenderer.on('download-progress', (event, progress) => {
  updateDownloadProgress(progress);
});

// Listen for disk space updates
ipcRenderer.on('disk-space-updated', (event, diskSpace) => {
  diskSpaceEl.style.display = 'block';
  diskSpaceValueEl.textContent = `${diskSpace.freeFormatted} free of ${diskSpace.totalFormatted}`;
});

// Listen for disk space warnings
ipcRenderer.on('disk-space-low', (event, data) => {
  showNotification('⚠️ Disk Space Low', `Only ${data.freeFormatted} remaining`, 'warning');
});

ipcRenderer.on('disk-space-critical', (event, data) => {
  showNotification('🚨 Disk Space Critical', `Only ${data.freeFormatted} remaining!`, 'error');
});

// ===== EVENT HANDLERS =====

// Retry yt-dlp check
retryYtdlpBtn.addEventListener('click', () => {
  location.reload();
});

// Choose download folder
chooseFolderBtn.addEventListener('click', async () => {
  const folderPath = await ipcRenderer.invoke('choose-download-directory');
  
  if (folderPath) {
    downloadPathInput.value = folderPath;
    settings.downloadPath = folderPath;
    
    // Save settings
    ipcRenderer.send('save-settings', settings);
    
    // Show download panel
    downloadPanelEl.style.display = 'block';
    downloadsListEl.style.display = 'block';
  }
});

// Start download
startDownloadBtn.addEventListener('click', () => {
  const url = videoUrlInput.value.trim();
  
  if (!url) {
    showNotification('⚠️ No URL', 'Please enter a YouTube URL', 'warning');
    return;
  }
  
  if (!settings.downloadPath) {
    showNotification('⚠️ No Download Folder', 'Please choose a download folder first', 'warning');
    return;
  }
  
  const format = qualitySelect.value;
  const options = {};
  
  if (format) {
    options.format = format;
  }
  
  // Add to download queue
  ipcRenderer.send('add-download', {
    url: url,
    outputPath: settings.downloadPath,
    options: options
  });
  
  // Clear input
  videoUrlInput.value = '';
  
  showNotification('✅ Added to Queue', 'Download will start soon', 'success');
});

// Handle external links
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('link') && e.target.dataset.url) {
    e.preventDefault();
    shell.openExternal(e.target.dataset.url);
  }
});

// ===== UI FUNCTIONS =====

/**
 * Update downloads list
 */
function updateDownloadsList() {
  downloadsContainerEl.innerHTML = '';
  
  const allDownloads = [
    ...(queueState.currentDownload ? [queueState.currentDownload] : []),
    ...(queueState.queue || []),
    ...(queueState.history || [])
  ];
  
  if (allDownloads.length === 0) {
    downloadsContainerEl.innerHTML = '<p class="no-downloads">No downloads yet</p>';
    return;
  }
  
  allDownloads.forEach(download => {
    const downloadEl = createDownloadElement(download);
    downloadsContainerEl.appendChild(downloadEl);
  });
}

/**
 * Create download element
 */
function createDownloadElement(download) {
  const el = document.createElement('div');
  el.className = `download-item status-${download.status}`;
  el.dataset.id = download.id;
  
  // Status icon
  let statusIcon = '⏳';
  if (download.status === 'downloading') statusIcon = '⬇️';
  if (download.status === 'completed') statusIcon = '✅';
  if (download.status === 'failed') statusIcon = '❌';
  if (download.status === 'cancelled') statusIcon = '🚫';
  
  // Get video title from URL (simplified)
  const urlParts = download.url.split('/');
  const videoId = urlParts[urlParts.length - 1] || 'Video';
  
  // Create HTML
  el.innerHTML = `
    <div class="download-icon">${statusIcon}</div>
    <div class="download-info">
      <div class="download-url">${truncateUrl(download.url)}</div>
      <div class="download-status-text">${getStatusText(download)}</div>
      ${download.status === 'downloading' ? `
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${download.progress}%"></div>
          <div class="progress-text">${Math.round(download.progress)}%</div>
        </div>
      ` : ''}
      ${download.error ? `<div class="download-error">${download.error}</div>` : ''}
    </div>
    <div class="download-actions">
      ${createDownloadActions(download)}
    </div>
  `;
  
  // Add event listeners
  setupDownloadActions(el, download);
  
  return el;
}

/**
 * Get status text
 */
function getStatusText(download) {
  if (download.status === 'pending') return 'Waiting in queue...';
  if (download.status === 'downloading') return 'Downloading...';
  if (download.status === 'completed' && download.completedAt) {
    const date = new Date(download.completedAt);
    return `Completed ${date.toLocaleString()}`;
  }
  if (download.status === 'failed') return 'Download failed';
  if (download.status === 'cancelled') return 'Cancelled';
  return download.status;
}

/**
 * Create download action buttons
 */
function createDownloadActions(download) {
  if (download.status === 'completed') {
    return `
      <button class="btn-icon" data-action="open" title="Open Video">▶️</button>
      <button class="btn-icon" data-action="show-folder" title="Show in Folder">📁</button>
    `;
  }
  
  if (download.status === 'failed') {
    return `
      <button class="btn-icon" data-action="retry" title="Retry">🔄</button>
    `;
  }
  
  if (download.status === 'pending') {
    return `
      <button class="btn-icon" data-action="cancel" title="Cancel">🚫</button>
    `;
  }
  
  return '';
}

/**
 * Setup download action buttons
 */
function setupDownloadActions(el, download) {
  const buttons = el.querySelectorAll('.btn-icon');
  
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      
      if (action === 'open') {
        ipcRenderer.send('open-video', download.filepath);
      } else if (action === 'show-folder') {
        ipcRenderer.send('show-in-folder', download.filepath);
      } else if (action === 'retry') {
        ipcRenderer.send('retry-download', download.id);
      } else if (action === 'cancel') {
        ipcRenderer.send('cancel-download', download.id);
      }
    });
  });
}

/**
 * Update download progress
 */
function updateDownloadProgress(progress) {
  const downloadEl = document.querySelector(`[data-id="${progress.id}"]`);
  if (!downloadEl) return;
  
  const progressFill = downloadEl.querySelector('.progress-fill');
  const progressText = downloadEl.querySelector('.progress-text');
  
  if (progressFill) {
    progressFill.style.width = `${progress.progress}%`;
  }
  
  if (progressText) {
    progressText.textContent = `${Math.round(progress.progress)}%`;
  }
}

/**
 * Show notification
 */
function showNotification(title, message, type = 'info') {
  // Simple notification (could be improved with a notification library)
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.innerHTML = `
    <div class="notification-title">${title}</div>
    <div class="notification-message">${message}</div>
  `;
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.classList.add('notification-show');
  }, 10);
  
  setTimeout(() => {
    notification.classList.remove('notification-show');
    setTimeout(() => {
      notification.remove();
    }, 300);
  }, 3000);
}

/**
 * Truncate URL for display
 */
function truncateUrl(url) {
  if (url.length <= 50) return url;
  return url.substring(0, 47) + '...';
}
