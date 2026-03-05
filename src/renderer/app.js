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

// Cookie / Auth elements
const cookieSourceSelect = document.getElementById('cookie-source');
const cookieFileSetting = document.getElementById('cookie-file-setting');
const cookieFilePathInput = document.getElementById('cookie-file-path');
const chooseCookieFileBtn = document.getElementById('choose-cookie-file-btn');
const customUserAgentInput = document.getElementById('custom-user-agent');
const extraArgsInput = document.getElementById('extra-args');
const jsRuntimeSelect = document.getElementById('js-runtime-select');
const jsRuntimeStatus = document.getElementById('js-runtime-status');

// ffmpeg / tool help elements
const ffmpegBadge = document.getElementById('ffmpeg-badge');
const ffmpegStatusText = document.getElementById('ffmpeg-status-text');
const ytdlpBadge = document.getElementById('ytdlp-badge');
const toolHelp = document.getElementById('tool-help');
const aiHelpPrompt = document.getElementById('ai-help-prompt');
const copyAiPromptBtn = document.getElementById('copy-ai-prompt-btn');

// Track tool status for help prompt
let toolStatus = { ytdlp: null, ffmpeg: null };

// Advanced per-download options
const advancedToggle = document.getElementById('advanced-toggle');
const advancedToggleIcon = document.getElementById('advanced-toggle-icon');
const advancedOptions = document.getElementById('advanced-options');
const advOverrideCookies = document.getElementById('adv-override-cookies');
const advCookieSource = document.getElementById('adv-cookie-source');
const advForceIpv4 = document.getElementById('adv-force-ipv4');
const advCustomReferer = document.getElementById('adv-custom-referer');
const advReferer = document.getElementById('adv-referer');
const advExtractorArgs = document.getElementById('adv-extractor-args');
const advExtractorArgsValue = document.getElementById('adv-extractor-args-value');

// Retry modal elements
const retryModal = document.getElementById('retry-modal');
const retryModalClose = document.getElementById('retry-modal-close');
const retryModalCancel = document.getElementById('retry-modal-cancel');
const retryModalGo = document.getElementById('retry-modal-go');
const retryUrlEl = document.getElementById('retry-url');
const retryErrorEl = document.getElementById('retry-error');
let retryDownloadId = null;

// ===== INITIALIZATION =====

// Listen for yt-dlp status
ipcRenderer.on('ytdlp-status', (event, ytdlpInfo) => {
  console.log('yt-dlp status:', ytdlpInfo);
  ytdlpAvailable = ytdlpInfo.available;
  toolStatus.ytdlp = ytdlpInfo;
  
  loadingEl.style.display = 'none';
  
  if (ytdlpInfo.available) {
    ytdlpBadge.className = 'status-badge status-found';
    ytdlpBadge.querySelector('.status-icon').textContent = '\u2713';
    document.getElementById('ytdlp-status-text').textContent = `Found (${ytdlpInfo.version})`;
    // Settings panel is hidden by default, toggle with § key
    settingsPanelEl.style.display = 'none';
    
    // Show JS runtime status
    if (ytdlpInfo.jsRuntimes && ytdlpInfo.jsRuntimes.length > 0) {
      const names = ytdlpInfo.jsRuntimes.map(r => r.name).join(', ');
      jsRuntimeStatus.textContent = `\u2705 Found: ${names}`;
      jsRuntimeStatus.style.color = '#155724';
    } else {
      jsRuntimeStatus.textContent = '\u26a0\ufe0f No JS runtime found! YouTube will not work. Install Node.js or Deno.';
      jsRuntimeStatus.style.color = '#dc3545';
      showNotification('\u26a0\ufe0f Missing JS Runtime', 'YouTube downloads need Node.js or Deno. Install one and restart.', 'warning');
    }
  } else {
    ytdlpBadge.className = 'status-badge status-missing';
    ytdlpBadge.querySelector('.status-icon').textContent = '\u2717';
    document.getElementById('ytdlp-status-text').textContent = 'Not Found';
    ytdlpMissingEl.style.display = 'block';
  }
  updateToolHelp();
});

// Listen for ffmpeg status
ipcRenderer.on('ffmpeg-status', (event, ffmpegInfo) => {
  console.log('ffmpeg status:', ffmpegInfo);
  toolStatus.ffmpeg = ffmpegInfo;
  
  if (ffmpegInfo.available) {
    ffmpegBadge.className = 'status-badge status-found';
    ffmpegBadge.querySelector('.status-icon').textContent = '\u2713';
    ffmpegStatusText.textContent = `Found (${ffmpegInfo.version})`;
  } else {
    ffmpegBadge.className = 'status-badge status-missing';
    ffmpegBadge.querySelector('.status-icon').textContent = '\u2717';
    ffmpegStatusText.textContent = 'Not Found';
  }
  updateToolHelp();
});

function updateToolHelp() {
  const ytdlpMissing = toolStatus.ytdlp && !toolStatus.ytdlp.available;
  const ffmpegMissing = toolStatus.ffmpeg && !toolStatus.ffmpeg.available;
  
  if (!ytdlpMissing && !ffmpegMissing) {
    toolHelp.style.display = 'none';
    return;
  }
  
  toolHelp.style.display = 'block';
  
  const missing = [];
  if (ytdlpMissing) missing.push('yt-dlp');
  if (ffmpegMissing) missing.push('ffmpeg');
  
  const osName = navigator.userAgent.includes('Windows') ? 'Windows' :
                 navigator.userAgent.includes('Mac') ? 'macOS' : 'Linux';
  
  const prompt = [
    `I'm using a desktop app called VideoNinja that needs these tools installed on my ${osName} computer:`,
    '',
    ...missing.map(t => `- ${t}: NOT INSTALLED`),
    ...(toolStatus.ytdlp?.available ? ['- yt-dlp: already installed'] : []),
    ...(toolStatus.ffmpeg?.available ? ['- ffmpeg: already installed'] : []),
    '',
    'What each tool does:',
    '- yt-dlp: Downloads videos from YouTube and other sites (required)',
    '- ffmpeg: Merges video + audio streams for best quality downloads (recommended)',
    '',
    'Please help me install the missing tool(s) step by step.',
    `I'm on ${osName}.`,
    'Give me the simplest method — preferably a single terminal command.',
    'After installing, tell me how to verify each tool works by running a version check command.',
  ].join('\n');
  
  aiHelpPrompt.textContent = prompt;
}

// Copy AI prompt button
copyAiPromptBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(aiHelpPrompt.textContent).then(() => {
    const original = copyAiPromptBtn.textContent;
    copyAiPromptBtn.textContent = '\u2705 Copied!';
    setTimeout(() => { copyAiPromptBtn.textContent = original; }, 2000);
  });
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
  
  // Restore cookie/auth settings
  if (settings.cookieSource) {
    cookieSourceSelect.value = settings.cookieSource;
    if (settings.cookieSource === 'file') {
      cookieFileSetting.style.display = 'block';
    }
  }
  if (settings.cookieFilePath) {
    cookieFilePathInput.value = settings.cookieFilePath;
  }
  if (settings.userAgent) {
    customUserAgentInput.value = settings.userAgent;
  }
  if (settings.extraArgs) {
    extraArgsInput.value = settings.extraArgs;
  }
  if (settings.jsRuntime) {
    jsRuntimeSelect.value = settings.jsRuntime;
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
    showNotification('⚠️ No URL', 'Please enter a video URL', 'warning');
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
  
  // Apply global cookie/auth settings
  const cookieSource = cookieSourceSelect.value;
  if (cookieSource === 'file' && settings.cookieFilePath) {
    options.cookieFile = settings.cookieFilePath;
  } else if (cookieSource && cookieSource !== 'file') {
    options.cookiesFromBrowser = cookieSource;
  }
  
  // Apply global user-agent
  if (customUserAgentInput.value.trim()) {
    options.userAgent = customUserAgentInput.value.trim();
  }
  
  // Apply global extra args
  if (extraArgsInput.value.trim()) {
    options.extraArgs = extraArgsInput.value.trim();
  }
  
  // Apply JS runtime setting
  const jsRuntimeVal = jsRuntimeSelect.value;
  if (jsRuntimeVal && jsRuntimeVal !== 'auto') {
    options.jsRuntime = jsRuntimeVal;
  }
  
  // Apply per-download advanced overrides
  if (advOverrideCookies.checked) {
    options.cookiesFromBrowser = advCookieSource.value;
    delete options.cookieFile;
  }
  if (advForceIpv4.checked) {
    options.forceIpv4 = true;
  }
  if (advCustomReferer.checked && advReferer.value.trim()) {
    options.referer = advReferer.value.trim();
  }
  if (advExtractorArgs.checked && advExtractorArgsValue.value.trim()) {
    options.extractorArgs = advExtractorArgsValue.value.trim();
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
  // Close retry modal with Escape
  if (e.key === 'Escape' && retryModal.style.display !== 'none') {
    retryModal.style.display = 'none';
  }
});

// ===== COOKIE / AUTH SETTINGS =====

// Cookie source change
cookieSourceSelect.addEventListener('change', () => {
  const val = cookieSourceSelect.value;
  cookieFileSetting.style.display = val === 'file' ? 'block' : 'none';
  settings.cookieSource = val;
  ipcRenderer.send('save-settings', settings);
  
  // Show contextual tips
  const tipsEl = document.getElementById('cookie-tips');
  if (val === 'file') {
    tipsEl.innerHTML = '<strong>How to export cookies:</strong><ol>' +
      '<li>Install a cookie export extension in Chrome (e.g. "Get cookies.txt LOCALLY")</li>' +
      '<li>Go to the site you want to download from (Instagram, YouTube, etc.)</li>' +
      '<li>Click the extension icon and export cookies for that site</li>' +
      '<li>Save the .txt file and select it below</li></ol>';
    tipsEl.style.display = 'block';
  } else if (val === 'chrome' || val === 'edge') {
    tipsEl.innerHTML = '<strong>⚠️ Important:</strong> You must <strong>completely close ' + 
      (val === 'chrome' ? 'Chrome' : 'Edge') + '</strong> before downloading ' +
      '(check Task Manager — end all background processes too). ' +
      'The browser locks its cookie database while running.<br>' +
      'If this doesn\'t work, use <strong>Cookie File</strong> export instead — it\'s the most reliable method.';
    tipsEl.style.display = 'block';
  } else {
    tipsEl.style.display = 'none';
  }
});

// Choose cookie file
chooseCookieFileBtn.addEventListener('click', async () => {
  const filePath = await ipcRenderer.invoke('choose-cookie-file');
  if (filePath) {
    cookieFilePathInput.value = filePath;
    settings.cookieFilePath = filePath;
    ipcRenderer.send('save-settings', settings);
  }
});

// Save user-agent on blur
customUserAgentInput.addEventListener('change', () => {
  settings.userAgent = customUserAgentInput.value.trim();
  ipcRenderer.send('save-settings', settings);
});

// Save extra args on blur
extraArgsInput.addEventListener('change', () => {
  settings.extraArgs = extraArgsInput.value.trim();
  ipcRenderer.send('save-settings', settings);
});

// Save JS runtime selection
jsRuntimeSelect.addEventListener('change', () => {
  settings.jsRuntime = jsRuntimeSelect.value;
  ipcRenderer.send('save-settings', settings);
});

// ===== ADVANCED OPTIONS TOGGLE =====

advancedToggle.addEventListener('click', () => {
  const isOpen = advancedOptions.style.display !== 'none';
  advancedOptions.style.display = isOpen ? 'none' : 'block';
  advancedToggleIcon.classList.toggle('open', !isOpen);
});

// Enable/disable per-download override fields
advOverrideCookies.addEventListener('change', () => {
  advCookieSource.disabled = !advOverrideCookies.checked;
});
advCustomReferer.addEventListener('change', () => {
  advReferer.disabled = !advCustomReferer.checked;
});
advExtractorArgs.addEventListener('change', () => {
  advExtractorArgsValue.disabled = !advExtractorArgs.checked;
});

// ===== RETRY MODAL =====

function openRetryModal(downloadId) {
  retryDownloadId = downloadId;
  
  // Find the download in state
  const download = [...(queueState.history || []), ...(queueState.queue || [])].find(d => d.id === downloadId);
  if (!download) return;
  
  retryUrlEl.textContent = download.url;
  retryErrorEl.textContent = download.error || 'Unknown error';
  
  // Auto-detect suggestions based on error and URL
  const error = (download.error || '').toLowerCase();
  const url = (download.url || '').toLowerCase();
  
  // Detect cookie DPAPI/copy errors (browser can't share cookie DB)
  const hasCookieError = error.includes('dpapi') || error.includes('could not copy') || 
    error.includes('cookie database');
  const cookieHintEl = document.getElementById('retry-cookie-hint');
  
  // Auto-check cookies for Instagram, login-required errors (but NOT for cookie-copy errors)
  const needsCookies = !hasCookieError && (
    url.includes('instagram') || url.includes('tiktok') || 
    error.includes('login') || error.includes('csrf') || 
    error.includes('empty media') || error.includes('403') || error.includes('rate-limit'));
  document.getElementById('retry-use-cookies').checked = needsCookies;
  
  // If Chrome/Edge cookies failed, show hint but do NOT auto-check cookies (that's what failed!)
  if (hasCookieError) {
    document.getElementById('retry-use-cookies').checked = false;
    cookieHintEl.textContent = '⚠️ Browser cookie access failed last time. Try without cookies first. If the site needs authentication, close Chrome/Edge completely (including background processes) and re-enable cookies, or use Cookie File export.';
    cookieHintEl.style.display = 'block';
  } else if (needsCookies) {
    document.getElementById('retry-cookie-browser').value = 'chrome';
    cookieHintEl.textContent = '💡 Close Chrome completely before retrying. If it still fails, export cookies to a file using a Chrome extension.';
    cookieHintEl.style.display = 'block';
  } else {
    cookieHintEl.textContent = '';
    cookieHintEl.style.display = 'none';
  }
  
  // Detect YouTube JS runtime issues
  const isYoutubeJsIssue = url.includes('youtube') && (
    error.includes('javascript runtime') || error.includes('js runtime') || 
    error.includes('js-runtimes') || error.includes('deno is enabled') ||
    error.includes('postprocessing') || error.includes('stream #'));
  const jsRuntimeCheckbox = document.getElementById('retry-js-runtime');
  const jsRuntimeValueEl = document.getElementById('retry-js-runtime-value');
  jsRuntimeCheckbox.checked = isYoutubeJsIssue;
  jsRuntimeValueEl.disabled = !isYoutubeJsIssue;
  if (isYoutubeJsIssue) {
    jsRuntimeValueEl.value = 'node';
  }
  
  // Auto-suggest extractor args for YouTube nsig issues
  const isYoutubeNsig = url.includes('youtube') && (error.includes('nsig') || error.includes('empty'));
  document.getElementById('retry-extractor-args').checked = isYoutubeNsig;
  const extractorInput = document.getElementById('retry-extractor-value');
  if (isYoutubeNsig) {
    extractorInput.value = 'youtube:player_client=web';
    extractorInput.disabled = false;
  } else {
    extractorInput.value = '';
    extractorInput.disabled = true;
  }
  
  // Reset other fields
  document.getElementById('retry-force-ipv4').checked = false;
  document.getElementById('retry-custom-ua').checked = false;
  document.getElementById('retry-ua-value').disabled = true;
  document.getElementById('retry-referer').checked = false;
  document.getElementById('retry-referer-value').disabled = true;
  document.getElementById('retry-extra-args').checked = false;
  document.getElementById('retry-extra-value').disabled = true;
  document.getElementById('retry-extra-value').value = '';
  
  retryModal.style.display = 'flex';
}

// Retry modal checkbox toggles
document.getElementById('retry-custom-ua').addEventListener('change', function () {
  document.getElementById('retry-ua-value').disabled = !this.checked;
});
document.getElementById('retry-referer').addEventListener('change', function () {
  document.getElementById('retry-referer-value').disabled = !this.checked;
});
document.getElementById('retry-extractor-args').addEventListener('change', function () {
  document.getElementById('retry-extractor-value').disabled = !this.checked;
});
document.getElementById('retry-extra-args').addEventListener('change', function () {
  document.getElementById('retry-extra-value').disabled = !this.checked;
});
document.getElementById('retry-js-runtime').addEventListener('change', function () {
  document.getElementById('retry-js-runtime-value').disabled = !this.checked;
});

// Close retry modal
retryModalClose.addEventListener('click', () => { retryModal.style.display = 'none'; });
retryModalCancel.addEventListener('click', () => { retryModal.style.display = 'none'; });

// Execute retry with options
retryModalGo.addEventListener('click', () => {
  if (!retryDownloadId) return;
  
  const options = {};
  
  if (document.getElementById('retry-use-cookies').checked) {
    options.cookiesFromBrowser = document.getElementById('retry-cookie-browser').value;
  }
  if (document.getElementById('retry-js-runtime').checked) {
    options.jsRuntime = document.getElementById('retry-js-runtime-value').value;
  }
  if (document.getElementById('retry-force-ipv4').checked) {
    options.forceIpv4 = true;
  }
  if (document.getElementById('retry-custom-ua').checked) {
    const ua = document.getElementById('retry-ua-value').value.trim();
    if (ua) options.userAgent = ua;
  }
  if (document.getElementById('retry-referer').checked) {
    const ref = document.getElementById('retry-referer-value').value.trim();
    if (ref) options.referer = ref;
  }
  if (document.getElementById('retry-extractor-args').checked) {
    const ea = document.getElementById('retry-extractor-value').value.trim();
    if (ea) options.extractorArgs = ea;
  }
  if (document.getElementById('retry-extra-args').checked) {
    const extra = document.getElementById('retry-extra-value').value.trim();
    if (extra) options.extraArgs = extra;
  }
  
  ipcRenderer.send('retry-with-options', { downloadId: retryDownloadId, options });
  retryModal.style.display = 'none';
  showNotification('🔄 Retrying', 'Download queued with special options! 🥷', 'info');
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
      <button class="btn-icon" data-action="retry-options" title="Retry with Options">🛠️</button>
      <button class="btn-icon" data-action="retry" title="Quick Retry">🔄</button>
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
      } else if (action === 'retry-options') {
        openRetryModal(download.id);
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
