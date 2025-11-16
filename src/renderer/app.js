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

const downloadPathInput = document.getElementById('download-path');
const videoUrlInput = document.getElementById('video-url');
const qualitySelect = document.getElementById('quality-select');
const diskSpaceEl = document.getElementById('disk-space');
const diskSpaceValueEl = document.getElementById('disk-space-value');
const headerToggle = document.getElementById('header-toggle');
const closeBtn = document.getElementById('close-btn');
const startupToggleBtn = document.getElementById('startup-toggle-btn');

// ===== INITIALIZATION =====

// Listen for yt-dlp status
ipcRenderer.on('ytdlp-status', (event, ytdlpInfo) => {
  console.log('yt-dlp status:', ytdlpInfo);
  ytdlpAvailable = ytdlpInfo.available;
  
  loadingEl.style.display = 'none';
  
  if (ytdlpInfo.available) {
    // Show just a simple "Found" badge instead of the full path
    // Settings panel is hidden by default, toggle with § key
    settingsPanelEl.style.display = 'none';
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
  
  // Show settings hint notification
  showNotification('💡 Tip', 'Click header or press F3 to toggle settings', 'info');
});

// Listen for queue updates
ipcRenderer.on('queue-updated', (event, state) => {
  console.log('Queue updated:', state);
  queueState = state;
  updateDownloadsList();
});

// Listen for download started
ipcRenderer.on('download-started', (event, download) => {
  const startQuotes = [
    'Let the download begin! 🥷',
    'Downloading jutsu activated! ⚡',
    'Shadow Clone is fetching your video! 📥',
    'Rasengan spin... I mean, download starting! 🌀',
    'The ninja way: patience during download! 🍃',
    'Believe it! Download starting, dattebayo! 🍥',
    'Kakashi-sensei says: Copy that video! 📋',
    'Download mission accepted! 🎯',
    'Pervy Sage needs this for... research! 📖',
    'Summoning Jutsu: Video Download! 🦊',
    'The path of downloads is never easy... ⏬',
    'DYNAMIC DOWNLOAD! 💥',
    'Going into Sage Mode... download mode! 🐸',
    'Sharingan copying the video! 👁️',
    'The Will of Fire... to download! 🔥',
    'Team 7 is on the mission! 👊',
    'Downloading faster than Minato\'s Flash! ⚡',
    'Ichiraku Ramen can wait, downloading first! 🍜',
    'Talk no Jutsu failed, using Download Jutsu! 💬',
    'The legendary download begins! 🌟'
  ];
  const quote = startQuotes[Math.floor(Math.random() * startQuotes.length)];
  showNotification('🥷 Download Started', quote, 'info');
});

// Listen for download completed
ipcRenderer.on('download-completed', (event, download) => {
  const completeQuotes = [
    'Mission accomplished! DATTEBAYO! 🎉',
    'Download complete! Believe it! ✨',
    'Perfect download! Just like my Rasengan! 💯',
    'Success! The ninja way prevails! 🥷',
    'Download finished! Time for ramen! 🍜',
    'Kakashi would be proud of this speed! 👍',
    'Victory! The video is ours! 🏆',
    'Download complete! Godly timing! ⚡',
    'The scroll has been acquired! 📜',
    'Mission success! Pervy Sage approves! 😏',
    'Downloaded! Now that\'s some good research material! 📚',
    'Flawless execution! Shinobi style! 🎯',
    'The download is complete, my student! 🙏',
    'Success rate: 100%! Like my jutsu! 💪',
    'Video acquired! The legend continues! 🌟',
    'Download finished faster than I became Hokage! 🔥',
    'Perfect! Time to watch with Hinata-chan! 💕',
    'Mission complete! Shadow clones helped! 🥷🥷',
    'The video is in our possession! 📹',
    'Download success! That\'s my ninja way! ✌️'
  ];
  const quote = completeQuotes[Math.floor(Math.random() * completeQuotes.length)];
  showNotification('🎊 Download Complete!', quote, 'success');
});

// Listen for download failed
ipcRenderer.on('download-failed', (event, download) => {
  const failQuotes = [
    'Download failed... but I never give up! 💪',
    'Temporary setback! The ninja way is to try again! 🔄',
    'Failed? Time to use my secret technique: Retry! 🥷',
    'Even Naruto failed many times before succeeding! 💭',
    'This is just training! Let\'s try again! 🎯',
    'Download interrupted... like my Rasengan training! 😅',
    'Believe it or not, we\'ll get it next time! 🍥',
    'Even the Hokage faces failures! Retry! 🔥',
    'The path of downloads has obstacles... 🌊',
    'Pervy Sage says: Learn from mistakes! 📖',
    'Failed download is just another lesson! 📚',
    'The ninja never gives up! Trying again! 💪',
    'Shadow Clone failed, but real ninja persists! 🥷',
    'Even the best jutsu fails sometimes! 🌀',
    'This is not defeat, just a detour! 🛤️'
  ];
  const quote = failQuotes[Math.floor(Math.random() * failQuotes.length)];
  showNotification('⚠️ Download Failed', quote, 'error');
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

// Listen for startup status
ipcRenderer.on('startup-status', (event, isEnabled) => {
  updateStartupButton(isEnabled);
});

// ===== EVENT HANDLERS =====

// Retry yt-dlp check
retryYtdlpBtn.addEventListener('click', () => {
  location.reload();
});

// Toggle startup on/off
startupToggleBtn.addEventListener('click', async () => {
  const result = await ipcRenderer.invoke('toggle-startup');
  updateStartupButton(result.enabled);
  
  if (result.enabled) {
    showNotification('✅ Startup Enabled', 'VideoNinja will start with Windows', 'success');
  } else {
    showNotification('❌ Startup Disabled', 'VideoNinja will not start automatically', 'info');
  }
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
  
  const addQuotes = [
    'Added to queue! Ninja patience required! ⏳',
    'Video queued up! Like waiting for Kakashi-sensei! ⏰',
    'In the queue, believe it! 🍥',
    'Your video is next in line! 📋',
    'Queued! The download will start soon! 🎯',
    'Added! Shadow clones are preparing! 🥷',
    'Queue updated! The mission begins shortly! 🌟',
    'Patience, young ninja! It\'s in the queue! 🍃',
    'Added successfully! Just like my jutsu! ✨',
    'Video queued! Time for some ramen while waiting! 🍜'
  ];
  const quote = addQuotes[Math.floor(Math.random() * addQuotes.length)];
  showNotification('✅ Added to Queue', quote, 'success');
});

// Handle external links
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('link') && e.target.dataset.url) {
    e.preventDefault();
    shell.openExternal(e.target.dataset.url);
  }
});

// Ninja wisdom and battle cries!
const ninjaQuotes = [
  'UNGALABUNGALA!',
  'HIYAAAA! 🥷',
  'Shadow clone technique!',
  'Believe it! Dattebayo!',
  'The way of the ninja is silence...',
  'NINJUTSU!',
  'Omae wa mou shindeiru...',
  'Rasengan!',
  'Stealth mode: ACTIVATED',
  'Like a leaf in the wind... 🍃',
  'The blade that cuts the stream!',
  'KAGE BUNSHIN NO JUTSU!',
  'Silent but deadly... wait, wrong ninja.',
  '忍者の道 (Ninja no Michi)',
  'Parkour! Oh wait, wrong skillset.',
  'Shuriken THROW! 🌟',
  'The ancient scrolls speak of...',
  'Hattori Hanzo would be proud!',
  'Legendary ninja Jiraiya says: Research! 📖',
  'Pervy Sage is doing "research" again... 👀',
  'Icha Icha Paradise - best seller! 📚',
  'The hot springs beckon... for research purposes! ♨️',
  'A true sage needs inspiration... visual inspiration! 😏',
  'Come come, paradise! Make-Out Tactics! 💋',
  'Age is just a number, and I\'m researching timeless beauty!',
  'Tsunade-sama... *nosebleed* 💉',
  'Research makes the world go round! 🌍',
  'The author of Icha Icha must never stop researching!',
  'Godly powers... and godly taste! 😎',
  'Pervy? I prefer "culturally sophisticated"! 🎭',
  'Never underestimate the importance of good research material!',
  'Naruto runs away... I mean, TO BATTLE!',
  'DATTEBAYO! Believe it or not! 🍥',
  'Ichiraku Ramen break time! 🍜',
  'Teuchi-san makes the best ramen in the world!',
  'I\'ll be Hokage someday, believe it! 🔥',
  'Nine-Tails chakra: ACTIVATED! 🦊',
  'Kurama, lend me your power!',
  'Talk no Jutsu is the strongest technique!',
  'I never go back on my word, that\'s my ninja way!',
  'Sasuke, you teme! Come back to Konoha! 😤',
  'Sakura-chan noticed me! ...in my dreams. 💭',
  'Kakashi-sensei is late again... classic! ⏰',
  'One day I\'ll surpass all the Hokages!',
  'Shadow Clone Jutsu! Now we can train 100x faster! 💪',
  'Sexy Jutsu! The ultimate technique! 💋',
  'Harem Jutsu! Pervy Sage taught me well! 😏',
  'Sage Mode: Toad Style! 🐸',
  'Mount Myōboku training was intense!',
  'Rasen-Shuriken! My own creation! 🌀',
  'Rasenshuriken go BRRRRR! ⚡',
  'The power of friendship and ramen! 🍜✨',
  'Hinata-chan is so cute when she faints! 💕',
  'Iruka-sensei believed in me from the start! 😊',
  'I\'ll protect my friends, no matter what!',
  'Pain... you took everything from me!',
  'I won\'t let the cycle of hatred continue!',
  'Jiraiya... Pervy Sage... thank you for everything! 😢',
  'The hero of the Hidden Leaf has arrived!',
  'Uzumaki Naruto, future Hokage! 🔶',
  'The Five Great Nations bow to none!',
  'Chakra levels: MAXIMUM',
  'Substitution Jutsu! *poof* 💨',
  'The path of the shinobi is never easy.',
  'WASSUP NINJA STYLE!',
  'Konohagakure sends its regards!',
  'The Third Hokage taught me well.',
  'Sasuke is my rival!',
  'Kakashi-sensei would use Sharingan here.',
  'Shadow possession complete.',
  'Byakugan! I can see everything!',
  'The Uchiha clan legacy lives on!',
  'Chidori! ⚡',
  'One thousand years of death! (uh, maybe not)',
  'The legendary Sannin unite!',
  'Tailed beast mode: LOADING...',
  'Sage mode activated! 🐸',
  'The Will of Fire burns eternal!',
  'Shinobi rule #25: Never give up!',
  'DYNAMIC ENTRY! 💥',
  'Might Guy approves this taijutsu!',
  'Rock Lee speed! No ninjutsu needed!',
  'The Eight Gates technique... dangerous!',
  'Akatsuki clouds gather... 🌧️',
  'Itachi-san... the feels.',
  'Madara Uchiha has entered the chat.',
  'So cool! DATTEBAYO!',
  'Ramen power! 🍜',
  'Ichiraku Ramen is the best!',
  'Pervy Sage! 📖',
  'Tsunade-sama heals all wounds.',
  'Orochimaru hissssss 🐍',
  'The Sound Four challenge you!',
  'Gaara of the Sand arrives.',
  'One Tail, Two Tails, all the Tails!',
  'Kurama the Nine-Tails says hello! 🦊',
  'Jinchūriki power!',
  'The Six Paths of Pain.',
  'Nagato... such sadness.',
  'Yahiko, Konan, Nagato - the original trio.',
  'The Rinnegan sees all realities!',
  'Planetary Devastation! 🌍',
  'Shinra Tensei! BOOM!',
  'Amaterasu black flames! 🔥',
  'Susanoo armor ENGAGED!',
  'Mangekyō Sharingan spinning!',
  'Tobi is a good boy! ...or is he?',
  'Obito... the tragedy.',
  'Rin... the catalyst.',
  'Kamui dimension travel!',
  'The Ten-Tails awakens!',
  'Kaguya Ōtsutsuki, the progenitor!',
  'Hagoromo, the Sage of Six Paths.',
  'Hamura Ōtsutsuki watches from the moon.',
  'Indra and Asura, eternal cycle.',
  'The curse of hatred vs. the will of fire.',
  'Hashirama cells! OP!',
  'Wood Style: Deep Forest Emergence! 🌳',
  'Tobirama invented Flying Thunder God!',
  'Minato the Yellow Flash! ⚡',
  'Fourth Hokage: coolest dad ever.',
  'Kushina: the Red Hot-Blooded Habanero! 🌶️',
  'Uzumaki clan sealing techniques!',
  'The Reaper Death Seal... ultimate sacrifice.',
  'Hiruzen Sarutobi: The Professor.',
  'All five nature transformations mastered!',
  'Wind, Fire, Lightning, Earth, Water! 🌪️🔥⚡🌍💧',
  'Yin-Yang Release!',
  'Truth-Seeking Balls!',
  'Six Paths Sage Mode!',
  'Ashura Mode: ACTIVATED!',
  'Indra\'s Arrow vs. Ashura!',
  'The Valley of the End... again.',
  'Boruto: Dad, you\'re embarrassing me.',
  'Next generation ninja!',
  'The era of shinobi continues!',
  'Ninjutsu, Taijutsu, Genjutsu - the trinity!',
  'Jōnin level achieved!',
  'ANBU Black Ops reporting!',
  'Root organization... shady business.',
  'Danzō and his Sharingan arm. Creepy.',
  'The ninja academy graduates!',
  'Team 7 forever! 👊',
  'The power of friendship! ✨',
  'Ninja way: Never back down!'
];

// Ninja says random wisdom!
const ninjaIcon = document.getElementById('ninja-icon');
ninjaIcon.addEventListener('click', (e) => {
  e.stopPropagation();
  const randomQuote = ninjaQuotes[Math.floor(Math.random() * ninjaQuotes.length)];
  showNotification('🥷', randomQuote, 'info');
});

// Camera flash!
const cameraIcon = document.getElementById('camera-icon');
cameraIcon.addEventListener('click', (e) => {
  e.stopPropagation();
  // Flash effect
  cameraIcon.style.filter = 'brightness(3) saturate(2)';
  setTimeout(() => {
    cameraIcon.style.filter = 'brightness(1) saturate(1)';
  }, 100);
  showNotification('📸', 'FLASH!', 'info');
});

// Toggle settings panel by clicking header
headerToggle.addEventListener('click', () => {
  if (settingsPanelEl.style.display === 'none') {
    settingsPanelEl.style.display = 'block';
  } else {
    settingsPanelEl.style.display = 'none';
  }
});

// Close button - hide window to tray
closeBtn.addEventListener('click', (e) => {
  e.stopPropagation(); // Don't trigger header toggle
  const { ipcRenderer } = require('electron');
  ipcRenderer.send('hide-window');
});

// Toggle settings panel with F3 key
document.addEventListener('keydown', (e) => {
  if (e.key === 'F3') {
    e.preventDefault();
    if (settingsPanelEl.style.display === 'none') {
      settingsPanelEl.style.display = 'block';
    } else {
      settingsPanelEl.style.display = 'none';
    }
  }
});

// ===== UI FUNCTIONS =====

/**
 * Update downloads list
 */
function updateDownloadsList() {
  downloadsContainerEl.innerHTML = '';
  
  // Show: queue (includes current download if it exists) + history
  const allDownloads = [];
  
  // Add queue items (currentDownload stays in queue until moved to history)
  if (queueState.queue && queueState.queue.length > 0) {
    allDownloads.push(...queueState.queue);
  }
  
  // Add history items
  if (queueState.history && queueState.history.length > 0) {
    allDownloads.push(...queueState.history);
  }
  
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

/**
 * Update startup button state
 */
function updateStartupButton(isEnabled) {
  if (isEnabled) {
    startupToggleBtn.textContent = '✅ Remove from Startup';
    startupToggleBtn.classList.add('startup-enabled');
  } else {
    startupToggleBtn.textContent = '➕ Add to Startup';
    startupToggleBtn.classList.remove('startup-enabled');
  }
}
