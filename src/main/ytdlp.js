const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');

const execAsync = promisify(exec);

/**
 * Check if yt-dlp is available on the system
 * @returns {Promise<{available: boolean, path: string|null, version: string|null}>}
 */
async function checkYtDlpAvailability() {
  const isWindows = process.platform === 'win32';
  const isMac = process.platform === 'darwin';
  
  // List of possible locations to check
  const possibleLocations = [];
  
  if (isWindows) {
    possibleLocations.push(
      'yt-dlp.exe',
      'yt-dlp',
      path.join(process.cwd(), 'yt-dlp.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'yt-dlp', 'yt-dlp.exe'),
      'C:\\Program Files\\yt-dlp\\yt-dlp.exe',
    );
  } else if (isMac) {
    // macOS placeholder - will be implemented later
    possibleLocations.push(
      'yt-dlp',
      '/usr/local/bin/yt-dlp',
      '/opt/homebrew/bin/yt-dlp',
    );
  }
  
  // Try each location
  for (const location of possibleLocations) {
    try {
      const command = isWindows 
        ? `"${location}" --version`
        : `${location} --version`;
      
      const { stdout } = await execAsync(command, { timeout: 5000 });
      const version = stdout.trim();
      
      console.log(`Found yt-dlp at: ${location}, version: ${version}`);
      return {
        available: true,
        path: location,
        version: version
      };
    } catch (error) {
      // Continue to next location
      continue;
    }
  }
  
  console.log('yt-dlp not found on system');
  return {
    available: false,
    path: null,
    version: null
  };
}

/**
 * Download a video using yt-dlp
 * @param {string} url - Video URL
 * @param {string} outputPath - Directory to save video
 * @param {object} options - Download options
 * @param {function} progressCallback - Callback for progress updates
 * @returns {Promise<{success: boolean, filepath: string|null, error: string|null}>}
 */
async function downloadVideo(url, outputPath, options = {}, progressCallback = null) {
  const ytdlpInfo = await checkYtDlpAvailability();
  
  if (!ytdlpInfo.available) {
    throw new Error('yt-dlp is not available on this system');
  }
  
  const ytdlpPath = ytdlpInfo.path;
  
  // Build command arguments
  const args = [url];
  
  // Output template
  const outputTemplate = path.join(outputPath, '%(title)s.%(ext)s');
  args.push('-o', outputTemplate);
  
  // Add format option if specified
  if (options.format) {
    args.push('-f', options.format);
  }
  
  // Add subtitles if requested
  if (options.subtitles) {
    args.push('--write-subs');
    args.push('--sub-lang', options.subtitleLang || 'en');
  }
  
  // Add other common options
  args.push('--no-playlist'); // Don't download playlists by default
  args.push('--progress'); // Show progress
  
  console.log(`Starting download: ${ytdlpPath} ${args.join(' ')}`);
  
  return new Promise((resolve, reject) => {
    const process = spawn(ytdlpPath, args, {
      shell: true,
      windowsHide: true
    });
    
    let downloadedFile = null;
    let errorOutput = '';
    
    // Parse stdout for progress
    process.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('yt-dlp output:', output);
      
      // Parse progress from output
      // Example: [download]  45.5% of 123.45MiB at 1.23MiB/s ETA 00:45
      const progressMatch = output.match(/\[download\]\s+(\d+\.?\d*)%/);
      if (progressMatch && progressCallback) {
        const percent = parseFloat(progressMatch[1]);
        progressCallback({
          type: 'progress',
          percent: percent,
          status: 'downloading'
        });
      }
      
      // Check for destination filename
      const destMatch = output.match(/\[download\] Destination: (.+)/);
      if (destMatch) {
        downloadedFile = destMatch[1].trim();
      }
      
      // Check if already downloaded
      const alreadyMatch = output.match(/\[download\] (.+) has already been downloaded/);
      if (alreadyMatch) {
        downloadedFile = alreadyMatch[1].trim();
      }
    });
    
    process.stderr.on('data', (data) => {
      const error = data.toString();
      console.error('yt-dlp error:', error);
      errorOutput += error;
      
      // Still parse for progress as yt-dlp sometimes outputs to stderr
      const progressMatch = error.match(/\[download\]\s+(\d+\.?\d*)%/);
      if (progressMatch && progressCallback) {
        const percent = parseFloat(progressMatch[1]);
        progressCallback({
          type: 'progress',
          percent: percent,
          status: 'downloading'
        });
      }
    });
    
    process.on('close', (code) => {
      if (code === 0) {
        console.log('Download completed successfully');
        if (progressCallback) {
          progressCallback({
            type: 'complete',
            percent: 100,
            status: 'completed'
          });
        }
        resolve({
          success: true,
          filepath: downloadedFile,
          error: null
        });
      } else {
        console.error('Download failed with code:', code);
        if (progressCallback) {
          progressCallback({
            type: 'error',
            percent: 0,
            status: 'failed',
            error: errorOutput
          });
        }
        resolve({
          success: false,
          filepath: null,
          error: errorOutput || `Download failed with exit code ${code}`
        });
      }
    });
    
    process.on('error', (error) => {
      console.error('Process error:', error);
      if (progressCallback) {
        progressCallback({
          type: 'error',
          percent: 0,
          status: 'failed',
          error: error.message
        });
      }
      reject(error);
    });
  });
}

/**
 * Get disk space information for a given path
 * @param {string} dirPath - Directory path to check
 * @returns {Promise<{total: number, free: number, used: number}>} Size in bytes
 */
async function getDiskSpace(dirPath) {
  // This is a simplified version - in production, use a library like 'diskusage'
  // For now, return mock data
  // TODO: Implement proper disk space checking
  
  if (process.platform === 'win32') {
    // Windows: use wmic or fsutil
    try {
      const drive = path.parse(dirPath).root;
      const { stdout } = await execAsync(`wmic logicaldisk where "DeviceID='${drive.replace('\\', '')}'" get FreeSpace,Size`);
      
      const lines = stdout.trim().split('\n');
      if (lines.length >= 2) {
        const values = lines[1].trim().split(/\s+/);
        const free = parseInt(values[0]);
        const total = parseInt(values[1]);
        
        return {
          total: total,
          free: free,
          used: total - free
        };
      }
    } catch (error) {
      console.error('Error getting disk space:', error);
    }
  }
  
  // Fallback: return mock data
  return {
    total: 500 * 1024 * 1024 * 1024, // 500 GB
    free: 50 * 1024 * 1024 * 1024,   // 50 GB
    used: 450 * 1024 * 1024 * 1024   // 450 GB
  };
}

/**
 * Format bytes to human readable string
 * @param {number} bytes 
 * @returns {string}
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

module.exports = {
  checkYtDlpAvailability,
  downloadVideo,
  getDiskSpace,
  formatBytes
};
