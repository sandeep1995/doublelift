import { getDatabase } from './database.js';
import { downloadVod, processVod } from './vod-processor.js';
import { broadcastStatus } from './websocket.js';
import { updatePlaylist } from './playlist-manager.js';

import * as vodProcessor from './vod-processor.js';

let downloadQueueInstance = null;

function broadcastQueueStatus() {
  if (!downloadQueueInstance) return;
  const status = downloadQueueInstance.getQueueStatus();
  broadcastStatus({
    type: 'queue_status_update',
    ...status,
  });
}

class DownloadQueue {
  constructor() {
    this.isProcessing = false;
    this.currentDownload = null;
    this.currentDownloadProcess = null;
    this.isPaused = false;
    this.maxRetries = 3;
    this.autoProcess = true;
    this.autoAddToPlaylist = true;
  }

  resetStuckDownloads() {
    const db = getDatabase();
    
    // Reset stuck downloads
    const stuckDownloads = db
      .prepare(
        `SELECT * FROM vods 
         WHERE download_status = 'downloading' 
         AND downloaded = 0`
      )
      .all();

    if (stuckDownloads.length > 0) {
      console.log(`Resetting ${stuckDownloads.length} stuck download(s) from previous session`);

      for (const vod of stuckDownloads) {
        // Reset to queued if retry count allows, otherwise mark as failed
        const newStatus = vod.retry_count < this.maxRetries ? 'queued' : 'failed';
        const errorMessage = newStatus === 'failed' 
          ? 'Download interrupted by server restart' 
          : vod.error_message;

        db.prepare(
          `UPDATE vods 
           SET download_status = ?, 
               error_message = ?,
               download_progress = 0
           WHERE id = ?`
        ).run(newStatus, errorMessage, vod.id);

        console.log(`Reset VOD ${vod.id} from 'downloading' to '${newStatus}'`);
      }
    }

    // Reset stuck processing
    const stuckProcessing = db
      .prepare(
        `SELECT * FROM vods 
         WHERE process_status = 'processing' 
         AND processed = 0`
      )
      .all();

    if (stuckProcessing.length > 0) {
      console.log(`Resetting ${stuckProcessing.length} stuck processing state(s) from previous session`);

      for (const vod of stuckProcessing) {
        db.prepare(
          `UPDATE vods 
           SET process_status = ?,
               error_message = ?
           WHERE id = ?`
        ).run('failed', 'Processing interrupted by server restart', vod.id);

        console.log(`Reset VOD ${vod.id} from 'processing' to 'failed'`);
      }
    }
  }

  async addToQueue(vodId) {
    const db = getDatabase();
    const vod = db.prepare('SELECT * FROM vods WHERE id = ?').get(vodId);

    if (!vod) {
      throw new Error(`VOD ${vodId} not found`);
    }

    if (vod.downloaded) {
      return { success: true, message: 'VOD already downloaded' };
    }

    db.prepare(
      'UPDATE vods SET download_status = ?, last_attempt_at = ? WHERE id = ?'
    ).run('queued', new Date().toISOString(), vodId);

    broadcastStatus({ type: 'vod_queued', vodId });
    broadcastQueueStatus();

    this.processQueue();

    return { success: true, message: 'VOD added to download queue' };
  }

  async processQueue() {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    this.isPaused = false;

    try {
      while (true) {
        // Check if paused
        if (this.isPaused) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue;
        }

        const db = getDatabase();
        const nextVod = db
          .prepare(
            `SELECT * FROM vods 
             WHERE download_status IN ('queued', 'failed', 'paused') 
             AND downloaded = 0 
             AND retry_count < ?
             ORDER BY 
               CASE download_status 
                 WHEN 'queued' THEN 0 
                 WHEN 'paused' THEN 1
                 WHEN 'failed' THEN 2 
               END,
               created_at DESC 
             LIMIT 1`
          )
          .get(this.maxRetries);

        if (!nextVod) {
          break;
        }

        this.currentDownload = nextVod.id;

        try {
          db.prepare(
            'UPDATE vods SET download_status = ?, last_attempt_at = ? WHERE id = ?'
          ).run('downloading', new Date().toISOString(), nextVod.id);
          
          broadcastQueueStatus();

          const downloadPromise = downloadVod(nextVod.id);
          
          // Store process reference once it's available
          const checkProcess = setInterval(() => {
            if (vodProcessor.downloadVod.activeProcesses && vodProcessor.downloadVod.activeProcesses.has(nextVod.id)) {
              this.currentDownloadProcess = vodProcessor.downloadVod.activeProcesses.get(nextVod.id);
              clearInterval(checkProcess);
            }
          }, 100);
          
          await downloadPromise;
          clearInterval(checkProcess);

          db.prepare(
            'UPDATE vods SET download_status = ?, retry_count = 0, error_message = NULL WHERE id = ?'
          ).run('completed', nextVod.id);

          broadcastStatus({
            type: 'download_complete',
            vodId: nextVod.id,
            title: nextVod.title,
          });
          broadcastQueueStatus();

          if (this.autoProcess) {
            try {
              console.log(`Auto-processing VOD ${nextVod.id}...`);
              await processVod(nextVod.id);

              if (this.autoAddToPlaylist) {
                console.log(`Auto-updating playlist after processing VOD ${nextVod.id}...`);
                await updatePlaylist();
              }
            } catch (processError) {
              console.error(`Auto-process failed for VOD ${nextVod.id}:`, processError.message);
            }
          }
        } catch (error) {
          // Check if error is due to cancellation/pause/stop
          if (error.message && (
            error.message.includes('Download cancelled') ||
            error.message.includes('Download paused') ||
            error.message.includes('Download stopped')
          )) {
            // Status already updated by pause/stop methods
            // Check current status to avoid overwriting
            const currentVod = db.prepare('SELECT * FROM vods WHERE id = ?').get(nextVod.id);
            if (currentVod && (currentVod.download_status === 'paused' || currentVod.download_status === 'cancelled')) {
              this.currentDownloadProcess = null;
              continue;
            }
          }

          console.error(`Failed to download VOD ${nextVod.id}:`, error);

          const retryCount = nextVod.retry_count + 1;
          const status = retryCount >= this.maxRetries ? 'failed' : 'queued';

          db.prepare(
            'UPDATE vods SET download_status = ?, retry_count = ?, error_message = ?, last_attempt_at = ? WHERE id = ?'
          ).run(
            status,
            retryCount,
            error.message,
            new Date().toISOString(),
            nextVod.id
          );

          broadcastStatus({
            type: 'download_error',
            vodId: nextVod.id,
            title: nextVod.title,
            error: error.message,
            retryCount,
            willRetry: retryCount < this.maxRetries,
          });
          broadcastQueueStatus();

          if (retryCount < this.maxRetries) {
            await new Promise((resolve) => setTimeout(resolve, 5000));
          }
        }

        this.currentDownload = null;
        this.currentDownloadProcess = null;
      }
    } finally {
      this.isProcessing = false;
      this.currentDownloadProcess = null;
    }
  }

  async retryFailed(vodId) {
    const db = getDatabase();
    const vod = db.prepare('SELECT * FROM vods WHERE id = ?').get(vodId);
    
    if (!vod) {
      throw new Error(`VOD ${vodId} not found`);
    }

    // Reset retry count and requeue, even if it previously exceeded max retries
    db.prepare(
      'UPDATE vods SET download_status = ?, retry_count = 0, error_message = NULL, last_attempt_at = ? WHERE id = ?'
    ).run('queued', new Date().toISOString(), vodId);

    broadcastStatus({ type: 'vod_retry', vodId });
    broadcastQueueStatus();
    this.processQueue();

    return { success: true, message: 'VOD queued for retry' };
  }

  async restartQueue() {
    const db = getDatabase();
    
    // Clear error messages from paused/cancelled downloads
    db.prepare(
      `UPDATE vods 
       SET error_message = NULL 
       WHERE download_status IN ('paused', 'cancelled') 
       AND error_message IS NOT NULL`
    ).run();

    // Clear paused flag if set
    this.isPaused = false;

    // Manually trigger queue processing
    broadcastQueueStatus();
    this.processQueue();
    return { success: true, message: 'Download queue processing started' };
  }

  async pauseDownload(vodId) {
    const db = getDatabase();
    const vod = db.prepare('SELECT * FROM vods WHERE id = ?').get(vodId);

    if (!vod) {
      throw new Error(`VOD ${vodId} not found`);
    }

    if (vod.download_status !== 'downloading') {
      return { success: false, message: 'VOD is not currently downloading' };
    }

    if (this.currentDownload !== vodId) {
      return { success: false, message: 'VOD is not the current download' };
    }

    // Update database status first to prevent error handling
    db.prepare(
      'UPDATE vods SET download_status = ?, error_message = NULL WHERE id = ?'
    ).run('paused', vodId);

    // Kill the download process
    let processKilled = false;
    if (this.currentDownloadProcess) {
      try {
        this.currentDownloadProcess.kill('SIGTERM');
        processKilled = true;
      } catch (error) {
        console.error(`Error killing download process for VOD ${vodId}:`, error);
      }
    }

    // Also try to kill via activeProcesses map
    if (!processKilled && vodProcessor.downloadVod.activeProcesses) {
      const process = vodProcessor.downloadVod.activeProcesses.get(vodId);
      if (process) {
        try {
          process.kill('SIGTERM');
          processKilled = true;
        } catch (error) {
          console.error(`Error killing download process for VOD ${vodId}:`, error);
        }
      }
    }

    this.currentDownloadProcess = null;

    // Set paused flag to stop queue processing
    this.isPaused = true;

    broadcastStatus({ type: 'download_paused', vodId, title: vod.title });
    broadcastQueueStatus();

    // Clear current download so queue can continue with other items
    this.currentDownload = null;

    return { success: true, message: 'Download paused' };
  }

  async resumeDownload(vodId) {
    const db = getDatabase();
    const vod = db.prepare('SELECT * FROM vods WHERE id = ?').get(vodId);

    if (!vod) {
      throw new Error(`VOD ${vodId} not found`);
    }

    if (vod.download_status !== 'paused') {
      return { success: false, message: 'VOD is not paused' };
    }

    // Change status back to queued
    db.prepare(
      'UPDATE vods SET download_status = ?, error_message = NULL WHERE id = ?'
    ).run('queued', vodId);

    broadcastStatus({ type: 'download_resumed', vodId, title: vod.title });
    broadcastQueueStatus();

    // Resume queue processing if it was paused
    if (this.isPaused) {
      this.isPaused = false;
    }

    // Trigger queue processing
    this.processQueue();

    return { success: true, message: 'Download resumed' };
  }

  async stopDownload(vodId) {
    const db = getDatabase();
    const vod = db.prepare('SELECT * FROM vods WHERE id = ?').get(vodId);

    if (!vod) {
      throw new Error(`VOD ${vodId} not found`);
    }

    // Update database status first to prevent error handling
    db.prepare(
      'UPDATE vods SET download_status = ?, error_message = NULL WHERE id = ?'
    ).run('cancelled', vodId);

    if ((vod.download_status === 'downloading' || vod.download_status === 'paused') && this.currentDownload === vodId) {
      // Kill the download process
      let processKilled = false;
      if (this.currentDownloadProcess) {
        try {
          this.currentDownloadProcess.kill('SIGTERM');
          processKilled = true;
        } catch (error) {
          console.error(`Error killing download process for VOD ${vodId}:`, error);
        }
      }

      // Also try to kill via activeProcesses map
      if (!processKilled && vodProcessor.downloadVod.activeProcesses) {
        const process = vodProcessor.downloadVod.activeProcesses.get(vodId);
        if (process) {
          try {
            process.kill('SIGTERM');
          } catch (error) {
            console.error(`Error killing download process for VOD ${vodId}:`, error);
          }
        }
      }

      this.currentDownloadProcess = null;

      // Clear paused flag if set
      this.isPaused = false;
      this.currentDownload = null;
    }

    broadcastStatus({ type: 'download_stopped', vodId, title: vod.title });
    broadcastQueueStatus();

    return { success: true, message: 'Download stopped' };
  }

  async cancelDownload(vodId) {
    // Alias for stopDownload for backward compatibility
    return this.stopDownload(vodId);
  }

  getQueueStatus() {
    const db = getDatabase();

    const queued = db
      .prepare('SELECT COUNT(*) as count FROM vods WHERE download_status = ?')
      .get('queued').count;

    const downloading = db
      .prepare('SELECT COUNT(*) as count FROM vods WHERE download_status = ?')
      .get('downloading').count;

    const failed = db
      .prepare('SELECT COUNT(*) as count FROM vods WHERE download_status = ?')
      .get('failed').count;

    return {
      queued,
      downloading,
      failed,
      currentDownload: this.currentDownload,
      isProcessing: this.isProcessing,
    };
  }
}

export const downloadQueue = new DownloadQueue();
downloadQueueInstance = downloadQueue;
