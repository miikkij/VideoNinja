const EventEmitter = require('events');
const path = require('path');
const { downloadVideo } = require('./ytdlp');

/**
 * Download Queue Manager
 * Manages video download queue and processes one download at a time
 */
class DownloadQueue extends EventEmitter {
  constructor() {
    super();
    this.queue = [];
    this.history = [];
    this.currentDownload = null;
    this.isProcessing = false;
  }

  /**
   * Add a download to the queue
   * @param {string} url - Video URL
   * @param {string} outputPath - Download directory
   * @param {object} options - Download options
   * @returns {string} Download ID
   */
  addDownload(url, outputPath, options = {}) {
    const download = {
      id: Date.now().toString(),
      url: url,
      outputPath: outputPath,
      options: options,
      status: 'pending',
      progress: 0,
      addedAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      error: null,
      filepath: null
    };

    this.queue.push(download);
    this.emit('queue-updated', this.getQueueState());

    // Start processing if not already processing
    if (!this.isProcessing) {
      this.processNext();
    }

    return download.id;
  }

  /**
   * Process next download in queue
   */
  async processNext() {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;
    const download = this.queue[0];
    this.currentDownload = download;

    download.status = 'downloading';
    download.startedAt = new Date().toISOString();
    this.emit('download-started', download);
    this.emit('queue-updated', this.getQueueState());

    try {
      const result = await downloadVideo(
        download.url,
        download.outputPath,
        download.options,
        (progress) => {
          // Update progress
          download.progress = progress.percent;
          this.emit('download-progress', {
            id: download.id,
            progress: progress.percent,
            status: progress.status
          });
          this.emit('queue-updated', this.getQueueState());
        }
      );

      if (result.success) {
        download.status = 'completed';
        download.progress = 100;
        download.completedAt = new Date().toISOString();
        download.filepath = result.filepath;
        this.emit('download-completed', download);
      } else {
        download.status = 'failed';
        download.error = result.error;
        this.emit('download-failed', download);
      }

    } catch (error) {
      download.status = 'failed';
      download.error = error.message;
      this.emit('download-failed', download);
    }

    // Move to history
    this.queue.shift();
    this.history.unshift(download);

    // Keep only last 100 items in history
    if (this.history.length > 100) {
      this.history = this.history.slice(0, 100);
    }

    this.currentDownload = null;
    this.isProcessing = false;
    this.emit('queue-updated', this.getQueueState());

    // Process next item
    if (this.queue.length > 0) {
      setTimeout(() => this.processNext(), 500);
    }
  }

  /**
   * Get current queue state
   * @returns {object}
   */
  getQueueState() {
    return {
      queue: this.queue,
      history: this.history,
      currentDownload: this.currentDownload,
      isProcessing: this.isProcessing
    };
  }

  /**
   * Cancel a pending download
   * @param {string} id - Download ID
   */
  cancelDownload(id) {
    const index = this.queue.findIndex(d => d.id === id);
    if (index !== -1) {
      const download = this.queue[index];
      download.status = 'cancelled';
      this.queue.splice(index, 1);
      this.history.unshift(download);
      this.emit('queue-updated', this.getQueueState());
      return true;
    }
    return false;
  }

  /**
   * Retry a failed download
   * @param {string} id - Download ID
   */
  retryDownload(id) {
    const download = this.history.find(d => d.id === id && d.status === 'failed');
    if (download) {
      // Create new download with same parameters
      return this.addDownload(download.url, download.outputPath, download.options);
    }
    return null;
  }

  /**
   * Load queue state from storage
   * @param {object} state - Saved state
   */
  loadState(state) {
    if (state.queue) {
      this.queue = state.queue;
    }
    if (state.history) {
      this.history = state.history;
    }

    // Resume pending/downloading items
    this.queue.forEach(download => {
      if (download.status === 'downloading') {
        download.status = 'pending';
        download.progress = 0;
      }
    });

    // Start processing
    if (this.queue.length > 0) {
      this.processNext();
    }
  }

  /**
   * Get state for persistence
   * @returns {object}
   */
  getStateForSave() {
    return {
      queue: this.queue,
      history: this.history
    };
  }
}

module.exports = DownloadQueue;
