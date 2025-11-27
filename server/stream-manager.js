import ffmpeg from 'fluent-ffmpeg';
import { existsSync } from 'fs';
import { getDatabase } from './database.js';
import { getPlaylist } from './playlist-manager.js';
import { broadcastStatus } from './websocket.js';

class StreamManager {
  constructor() {
    this.currentStreamProcess = null;
    this.isStreaming = false;
    this.currentIndex = 0;
    this.playlist = [];
    this.streamKey = null;
    this.isStopping = false;
  }

  resetStuckState() {
    const db = getDatabase();
    const state = db.prepare('SELECT * FROM stream_state WHERE id = 1').get();

    if (state && state.is_streaming && !this.isStreaming) {
      console.log('Resetting stuck stream state from previous session');
      db.prepare(
        `UPDATE stream_state 
         SET is_streaming = 0, 
             current_vod_id = NULL,
             stream_started_at = NULL,
             current_vod_started_at = NULL,
             last_vod_id = ?,
             last_vod_index = ?
         WHERE id = 1`
      ).run(state.current_vod_id, state.last_vod_index);
    }
  }

  async start(options = {}) {
    if (this.isStreaming) {
      return { success: false, message: 'Stream already running' };
    }

    const {
      resume = false,
      startFromIndex = null,
      startFromVodId = null,
    } = options;

    const playlist = getPlaylist();
    if (playlist.length === 0) {
      return { success: false, message: 'No VODs in playlist' };
    }

    const streamKey = process.env.TWITCH_RERUN_STREAM_KEY;
    if (!streamKey) {
      return {
        success: false,
        message: 'TWITCH_RERUN_STREAM_KEY not configured',
      };
    }

    this.isStreaming = true;
    this.isStopping = false;
    this.playlist = playlist;
    this.streamKey = streamKey;

    const db = getDatabase();
    const state = db.prepare('SELECT * FROM stream_state WHERE id = 1').get();

    // Determine starting index
    if (resume && state.last_vod_id) {
      // Try to resume from last position
      const lastIndex = playlist.findIndex(
        (p) => p.vod_id === state.last_vod_id
      );
      if (lastIndex >= 0) {
        this.currentIndex = lastIndex;
      } else if (state.last_vod_index !== null) {
        // Fallback to stored index if VOD not found
        this.currentIndex = Math.min(
          state.last_vod_index || 0,
          playlist.length - 1
        );
      } else {
        this.currentIndex = 0;
      }
    } else if (startFromVodId) {
      // Start from specific VOD ID
      const index = playlist.findIndex((p) => p.vod_id === startFromVodId);
      if (index === -1) {
        return {
          success: false,
          message: 'VOD not found in playlist',
        };
      }
      this.currentIndex = index;
    } else if (startFromIndex !== null) {
      // Start from specific index
      if (startFromIndex < 0 || startFromIndex >= playlist.length) {
        return {
          success: false,
          message: 'Invalid index',
        };
      }
      this.currentIndex = startFromIndex;
    } else {
      // Start from beginning
      this.currentIndex = 0;
    }

    const now = new Date().toISOString();
    db.prepare(
      'UPDATE stream_state SET is_streaming = 1, stream_started_at = ? WHERE id = 1'
    ).run(now);

    broadcastStatus({
      type: 'stream_start',
      vodCount: playlist.length,
      startIndex: this.currentIndex,
      resumed: resume,
    });

    // Broadcast unified stream status update
    const status = this.getStatus();
    broadcastStatus({
      type: 'stream_status_update',
      ...status,
    });

    this.streamNext();

    return {
      success: true,
      message: resume
        ? `Stream resumed from position ${this.currentIndex + 1}`
        : 'Stream started',
      startIndex: this.currentIndex,
    };
  }

  async stop() {
    if (!this.isStreaming) {
      return { success: false, message: 'Stream not running' };
    }

    this.isStopping = true;
    this.isStreaming = false;

    if (this.currentStreamProcess) {
      // Set a flag to ignore the error from graceful shutdown
      this.currentStreamProcess.kill('SIGINT');
      this.currentStreamProcess = null;
    }

    const db = getDatabase();
    const currentVodId = this.getCurrentVodId();

    // Save last position before clearing
    db.prepare(
      `UPDATE stream_state 
       SET is_streaming = 0, 
           current_vod_id = NULL, 
           stream_started_at = NULL, 
           current_vod_started_at = NULL,
           last_vod_index = ?,
           last_vod_id = ?
       WHERE id = 1`
    ).run(this.currentIndex, currentVodId);

    broadcastStatus({
      type: 'stream_stop',
      lastPosition: this.currentIndex + 1,
      lastVodId: currentVodId,
    });

    // Broadcast unified stream status update
    const status = this.getStatus();
    broadcastStatus({
      type: 'stream_status_update',
      ...status,
    });

    return {
      success: true,
      message: 'Stream stopped',
      lastPosition: this.currentIndex + 1,
      lastVodId: currentVodId,
    };
  }

  async skipToNext() {
    if (!this.isStreaming) {
      return { success: false, message: 'Stream not running' };
    }

    if (this.currentStreamProcess) {
      this.currentStreamProcess.kill('SIGINT');
      this.currentStreamProcess = null;
    }

    // streamNext will be called automatically via the 'end' event
    return { success: true, message: 'Skipping to next VOD' };
  }

  async skipToVod(vodId) {
    if (!this.isStreaming) {
      return { success: false, message: 'Stream not running' };
    }

    const index = this.playlist.findIndex((p) => p.vod_id === vodId);
    if (index === -1) {
      return { success: false, message: 'VOD not found in playlist' };
    }

    this.currentIndex = index;

    if (this.currentStreamProcess) {
      this.currentStreamProcess.kill('SIGINT');
      this.currentStreamProcess = null;
    }

    return {
      success: true,
      message: `Skipping to VOD at position ${index + 1}`,
    };
  }

  async reloadPlaylist() {
    if (!this.isStreaming) {
      return { success: false, message: 'Stream not running' };
    }

    const newPlaylist = getPlaylist();
    if (newPlaylist.length === 0) {
      return { success: false, message: 'New playlist is empty' };
    }

    this.playlist = newPlaylist;

    // If current VOD is not in new playlist, skip to next
    const currentVodId = this.getCurrentVodId();
    const stillInPlaylist = newPlaylist.some((p) => p.vod_id === currentVodId);

    if (!stillInPlaylist && this.currentStreamProcess) {
      this.currentStreamProcess.kill('SIGINT');
      this.currentStreamProcess = null;
    }

    return { success: true, message: 'Playlist reloaded' };
  }

  getCurrentVodId() {
    if (this.currentIndex >= 0 && this.currentIndex < this.playlist.length) {
      return this.playlist[this.currentIndex].vod_id;
    }
    return null;
  }

  streamNext(skipCount = 0) {
    if (!this.isStreaming || this.isStopping) {
      return;
    }

    if (this.playlist.length === 0) {
      console.error('Playlist is empty, stopping stream');
      this.stop();
      return;
    }

    if (skipCount >= this.playlist.length) {
      console.error('No valid VODs found in playlist, stopping stream');
      this.stop();
      return;
    }

    if (this.currentIndex >= this.playlist.length) {
      this.currentIndex = 0;
    }

    const currentVod = this.playlist[this.currentIndex];

    if (!currentVod || !currentVod.processed_file_path) {
      console.error(
        `VOD at index ${this.currentIndex} has no processed file, skipping`
      );
      this.currentIndex++;
      setTimeout(() => this.streamNext(skipCount + 1), 100);
      return;
    }

    if (!existsSync(currentVod.processed_file_path)) {
      console.error(
        `File not found: ${currentVod.processed_file_path}, skipping`
      );
      this.currentIndex++;
      setTimeout(() => this.streamNext(skipCount + 1), 100);
      return;
    }

    const db = getDatabase();
    const vodStartTime = new Date().toISOString();
    db.prepare(
      'UPDATE stream_state SET current_vod_id = ?, current_vod_started_at = ? WHERE id = 1'
    ).run(currentVod.vod_id, vodStartTime);

    console.log(`Streaming: ${currentVod.title}`);

    // Broadcast unified stream status update
    const status = this.getStatus();
    broadcastStatus({
      type: 'stream_vod_change',
      vodId: currentVod.vod_id,
      title: currentVod.title,
      position: this.currentIndex + 1,
      total: this.playlist.length,
      duration: currentVod.duration,
      startedAt: vodStartTime,
    });

    // Also broadcast full status for state sync
    broadcastStatus({
      type: 'stream_status_update',
      ...status,
    });

    this.currentStreamProcess = ffmpeg(currentVod.processed_file_path)
      .inputOptions('-re')
      .outputOptions([
        '-c:v libx264',
        '-preset veryfast',
        '-maxrate 6000k',
        '-bufsize 12000k',
        '-pix_fmt yuv420p',
        '-g 50',
        '-c:a aac',
        '-b:a 160k',
        '-ar 44100',
        '-f flv',
      ])
      .output(`rtmp://live.twitch.tv/app/${this.streamKey}`)
      .on('start', (commandLine) => {
        console.log('FFmpeg command:', commandLine);
      })
      .on('progress', (progress) => {
        if (progress.percent && this.isStreaming && !this.isStopping) {
          const db = getDatabase();
          const state = db
            .prepare('SELECT * FROM stream_state WHERE id = 1')
            .get();

          const streamElapsed = state.stream_started_at
            ? Math.floor(
                (Date.now() - new Date(state.stream_started_at).getTime()) /
                  1000
              )
            : 0;

          const vodElapsed = state.current_vod_started_at
            ? Math.floor(
                (Date.now() -
                  new Date(state.current_vod_started_at).getTime()) /
                  1000
              )
            : 0;

          broadcastStatus({
            type: 'stream_progress',
            percent: Math.round(progress.percent),
            vodId: currentVod.vod_id,
            streamElapsed,
            vodElapsed,
            currentTime: progress.timemark || null,
          });
        }
      })
      .on('end', () => {
        if (this.isStopping) {
          return;
        }

        console.log(`Finished streaming: ${currentVod.title}`);
        this.currentIndex++;

        // Persist progress update before moving to next
        const db = getDatabase();
        db.prepare(
          'UPDATE stream_state SET current_vod_id = ?, current_vod_started_at = NULL WHERE id = 1'
        ).run(null);

        // Broadcast unified stream status update
        const status = this.getStatus();
        broadcastStatus({
          type: 'stream_status_update',
          ...status,
        });

        setTimeout(() => this.streamNext(), 1000);
      })
      .on('error', (err) => {
        // Ignore errors from graceful shutdown (SIGINT/SIGTERM)
        if (
          this.isStopping ||
          err.message.includes('Exiting normally') ||
          err.message.includes('signal 2') ||
          err.message.includes('signal 15')
        ) {
          console.log('Stream stopped gracefully');
          return;
        }

        console.error('Streaming error:', err);
        broadcastStatus({ type: 'stream_error', error: err.message });

        if (this.isStreaming && !this.isStopping) {
          setTimeout(() => {
            if (this.isStreaming && !this.isStopping) {
              this.currentIndex++;
              this.streamNext();
            }
          }, 5000);
        }
      });

    this.currentStreamProcess.run();
  }

  getStatus() {
    const db = getDatabase();
    const state = db.prepare('SELECT * FROM stream_state WHERE id = 1').get();

    let streamElapsed = 0;
    let vodElapsed = 0;
    let currentVodTitle = null;
    let currentVodPosition = null;
    let currentVodTotal = null;
    let currentVodDuration = null;
    let lastVodTitle = null;

    if (state.is_streaming) {
      if (state.stream_started_at) {
        streamElapsed = Math.floor(
          (Date.now() - new Date(state.stream_started_at).getTime()) / 1000
        );
      }

      if (state.current_vod_id) {
        const vod = db
          .prepare('SELECT * FROM vods WHERE id = ?')
          .get(state.current_vod_id);
        if (vod) {
          currentVodTitle = vod.title;
          currentVodDuration = vod.duration;
        }

        const playlist = getPlaylist();
        const playlistIndex = playlist.findIndex(
          (p) => p.vod_id === state.current_vod_id
        );
        if (playlistIndex >= 0) {
          currentVodPosition = playlistIndex + 1;
          currentVodTotal = playlist.length;
        }

        if (state.current_vod_started_at) {
          vodElapsed = Math.floor(
            (Date.now() - new Date(state.current_vod_started_at).getTime()) /
              1000
          );
        }
      }
    } else if (state.last_vod_id) {
      // Get last VOD info for resume option
      const lastVod = db
        .prepare('SELECT * FROM vods WHERE id = ?')
        .get(state.last_vod_id);
      if (lastVod) {
        lastVodTitle = lastVod.title;
      }
    }

    return {
      isStreaming: Boolean(state.is_streaming),
      currentVodId: state.current_vod_id,
      streamStartedAt: state.stream_started_at,
      currentVodStartedAt: state.current_vod_started_at,
      streamElapsed,
      vodElapsed,
      currentVodTitle,
      currentVodPosition,
      currentVodTotal,
      currentVodDuration,
      lastVodId: state.last_vod_id,
      lastVodIndex: state.last_vod_index,
      lastVodTitle,
      lastScan: state.last_scan_at,
      playlistUpdated: state.playlist_updated_at,
    };
  }
}

export const streamManager = new StreamManager();

// Export functions for backward compatibility
export async function startStream(options) {
  return streamManager.start(options);
}

export async function stopStream() {
  return streamManager.stop();
}

export function getStreamStatus() {
  return streamManager.getStatus();
}
