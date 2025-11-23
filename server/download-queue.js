import { getDatabase } from './database.js';
import { downloadVod, processVod } from './vod-processor.js';
import { broadcastStatus } from './websocket.js';

class DownloadQueue {
  constructor() {
    this.isProcessing = false;
    this.currentDownload = null;
    this.maxRetries = 3;
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

    this.processQueue();

    return { success: true, message: 'VOD added to download queue' };
  }

  async processQueue() {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    try {
      while (true) {
        const db = getDatabase();
        const nextVod = db
          .prepare(
            `SELECT * FROM vods 
             WHERE download_status IN ('queued', 'failed') 
             AND downloaded = 0 
             AND retry_count < ?
             ORDER BY 
               CASE download_status 
                 WHEN 'queued' THEN 0 
                 WHEN 'failed' THEN 1 
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

          await downloadVod(nextVod.id);

          db.prepare(
            'UPDATE vods SET download_status = ?, retry_count = 0, error_message = NULL WHERE id = ?'
          ).run('completed', nextVod.id);

          broadcastStatus({
            type: 'download_complete',
            vodId: nextVod.id,
            title: nextVod.title,
          });
        } catch (error) {
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

          if (retryCount < this.maxRetries) {
            await new Promise((resolve) => setTimeout(resolve, 5000));
          }
        }

        this.currentDownload = null;
      }
    } finally {
      this.isProcessing = false;
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
    this.processQueue();

    return { success: true, message: 'VOD queued for retry' };
  }

  async restartQueue() {
    // Manually trigger queue processing
    this.processQueue();
    return { success: true, message: 'Download queue processing started' };
  }

  async cancelDownload(vodId) {
    const db = getDatabase();
    const vod = db.prepare('SELECT * FROM vods WHERE id = ?').get(vodId);

    if (
      vod &&
      vod.download_status === 'downloading' &&
      this.currentDownload === vodId
    ) {
      return { success: false, message: 'Cannot cancel download in progress' };
    }

    db.prepare(
      'UPDATE vods SET download_status = ?, error_message = ? WHERE id = ?'
    ).run('cancelled', 'Cancelled by user', vodId);

    broadcastStatus({ type: 'download_cancelled', vodId });

    return { success: true, message: 'Download cancelled' };
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
