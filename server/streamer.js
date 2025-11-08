import ffmpeg from 'fluent-ffmpeg';
import { getDatabase } from './database.js';
import { getPlaylist } from './playlist-manager.js';
import { broadcastStatus } from './websocket.js';

let currentStreamProcess = null;
let isStreaming = false;

export async function startStream() {
  if (isStreaming) {
    console.log('Stream already running');
    return { success: false, message: 'Stream already running' };
  }

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

  isStreaming = true;
  const db = getDatabase();
  db.prepare('UPDATE stream_state SET is_streaming = 1 WHERE id = 1').run();

  broadcastStatus({ type: 'stream_start', vodCount: playlist.length });

  streamPlaylist(playlist, streamKey);

  return { success: true, message: 'Stream started' };
}

export async function stopStream() {
  if (!isStreaming) {
    return { success: false, message: 'Stream not running' };
  }

  if (currentStreamProcess) {
    currentStreamProcess.kill('SIGINT');
    currentStreamProcess = null;
  }

  isStreaming = false;
  const db = getDatabase();
  db.prepare(
    'UPDATE stream_state SET is_streaming = 0, current_vod_id = NULL WHERE id = 1'
  ).run();

  broadcastStatus({ type: 'stream_stop' });

  return { success: true, message: 'Stream stopped' };
}

function streamPlaylist(playlist, streamKey) {
  let currentIndex = 0;

  function streamNext() {
    if (!isStreaming) {
      return;
    }

    if (currentIndex >= playlist.length) {
      currentIndex = 0;
    }

    const currentVod = playlist[currentIndex];
    const db = getDatabase();
    db.prepare('UPDATE stream_state SET current_vod_id = ? WHERE id = 1').run(
      currentVod.vod_id
    );

    console.log(`Streaming: ${currentVod.title}`);
    broadcastStatus({
      type: 'stream_vod_change',
      vodId: currentVod.vod_id,
      title: currentVod.title,
      position: currentIndex + 1,
      total: playlist.length,
    });

    currentStreamProcess = ffmpeg(currentVod.processed_file_path)
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
      .output(`rtmp://live.twitch.tv/app/${streamKey}`)
      .on('start', (commandLine) => {
        console.log('FFmpeg command:', commandLine);
      })
      .on('progress', (progress) => {
        if (progress.percent) {
          broadcastStatus({
            type: 'stream_progress',
            percent: Math.round(progress.percent),
            vodId: currentVod.vod_id,
          });
        }
      })
      .on('end', () => {
        console.log(`Finished streaming: ${currentVod.title}`);
        currentIndex++;
        setTimeout(() => streamNext(), 1000);
      })
      .on('error', (err) => {
        console.error('Streaming error:', err);
        broadcastStatus({ type: 'stream_error', error: err.message });

        setTimeout(() => {
          if (isStreaming) {
            currentIndex++;
            streamNext();
          }
        }, 5000);
      });

    currentStreamProcess.run();
  }

  streamNext();
}

export function getStreamStatus() {
  const db = getDatabase();
  const state = db.prepare('SELECT * FROM stream_state WHERE id = 1').get();

  return {
    isStreaming: Boolean(state.is_streaming),
    currentVodId: state.current_vod_id,
    lastScan: state.last_scan_at,
    playlistUpdated: state.playlist_updated_at,
  };
}
