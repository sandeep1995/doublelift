import { spawn } from 'child_process';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import axios from 'axios';
import ffmpeg from 'fluent-ffmpeg';
import { getDatabase } from './database.js';
import { getMutedSegments, getVodDetails } from './twitch-api.js';
import { broadcastStatus } from './websocket.js';

const VOD_STORAGE = process.env.VOD_STORAGE_PATH || './vods';
const PROCESSED_STORAGE = process.env.PROCESSED_STORAGE_PATH || './processed';

if (!existsSync(VOD_STORAGE)) mkdirSync(VOD_STORAGE, { recursive: true });
if (!existsSync(PROCESSED_STORAGE))
  mkdirSync(PROCESSED_STORAGE, { recursive: true });

async function getVodDownloadUrl(vodId) {
  /**
   * Sample response from getVodDetails:
   * {
   *   id: '2609909937',
   *   stream_id: '315570066648',
   *   user_id: '40017619',
   *   user_login: 'doublelift',
   *   user_name: 'Doublelift',
   *   title: '✅LAST STREAM BEFORE WORLDS + JAPAN TRIP, WILL BE BACK ON 11/16✅༼ ºل͜º ༽ºل͜º ༽ºل͜º ༽ ＥＶＥＲＹＯＮＥ，ＧＥＴ ＩＮ ＨＥＲＥ ༼ ºل͜º༼ ºل͜º༼ ºل͜º ༽✅',
   *   description: '',
   *   created_at: '2025-11-04T23:02:45Z',
   *   published_at: '2025-11-04T23:02:45Z',
   *   url: 'https://www.twitch.tv/videos/2609909937',
   *   thumbnail_url: 'https://static-cdn.jtvnw.net/cf_vods/d2nvs31859zcd8/e48f6b7600222960fdc8_doublelift_315570066648_1762297359//thumb/thumb0-%{width}x%{height}.jpg',
   *   viewable: 'public',
   *   view_count: 70293,
   *   language: 'en',
   *   type: 'archive',
   *   duration: '4h43m17s',
   *   muted_segments: null
   * }
   */
  const vodDetails = await getVodDetails(vodId);
  
  if (!vodDetails) {
    throw new Error(`VOD ${vodId} not found`);
  }

  const thumbnailUrl = vodDetails.thumbnail_url;
  if (!thumbnailUrl) {
    throw new Error('Could not find VOD thumbnail URL');
  }

  const baseUrl = thumbnailUrl.split('/thumb/')[0];
  return `${baseUrl}/chunked/index-dvr.m3u8`;
}

export async function downloadVod(vodId) {
  const db = getDatabase();
  const vod = db.prepare('SELECT * FROM vods WHERE id = ?').get(vodId);

  if (!vod) {
    throw new Error(`VOD ${vodId} not found in database`);
  }

  if (vod.downloaded && vod.file_path && existsSync(vod.file_path)) {
    console.log(`VOD ${vodId} already downloaded`);
    db.prepare('UPDATE vods SET download_status = ? WHERE id = ?').run(
      'completed',
      vodId
    );
    return vod.file_path;
  }

  broadcastStatus({ type: 'download_start', vodId, title: vod.title });

  db.prepare(
    'UPDATE vods SET download_status = ?, download_progress = 0, last_attempt_at = ? WHERE id = ?'
  ).run('downloading', new Date().toISOString(), vodId);

  try {
    const m3u8Url = await getVodDownloadUrl(vodId);
    const outputPath = join(VOD_STORAGE, `${vodId}.mp4`);

    await new Promise((resolve, reject) => {
      let lastPercent = 0;

      ffmpeg(m3u8Url)
        .outputOptions('-c copy')
        .output(outputPath)
        .on('progress', (progress) => {
          if (progress.percent) {
            const percent = Math.round(progress.percent);
            if (percent !== lastPercent) {
              lastPercent = percent;
              db.prepare(
                'UPDATE vods SET download_progress = ? WHERE id = ?'
              ).run(percent, vodId);

              broadcastStatus({
                type: 'download_progress',
                vodId,
                percent,
              });
            }
          }
        })
        .on('end', () => {
          console.log(`Downloaded VOD ${vodId}`);
          resolve();
        })
        .on('error', (err) => {
          console.error(`Error downloading VOD ${vodId}:`, err);
          reject(err);
        })
        .run();
    });

    db.prepare(
      'UPDATE vods SET downloaded = 1, download_status = ?, download_progress = 100, file_path = ?, error_message = NULL WHERE id = ?'
    ).run('completed', outputPath, vodId);

    broadcastStatus({ type: 'download_complete', vodId, title: vod.title });
    return outputPath;
  } catch (error) {
    db.prepare(
      'UPDATE vods SET download_status = ?, error_message = ? WHERE id = ?'
    ).run('failed', error.message, vodId);

    broadcastStatus({ type: 'download_error', vodId, error: error.message });
    throw error;
  }
}

function parseDuration(duration) {
  const match = duration.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
  const hours = parseInt(match[1] || 0);
  const minutes = parseInt(match[2] || 0);
  const seconds = parseInt(match[3] || 0);
  return hours * 3600 + minutes * 60 + seconds;
}

export async function processVod(vodId) {
  const db = getDatabase();
  const vod = db.prepare('SELECT * FROM vods WHERE id = ?').get(vodId);

  if (!vod || !vod.downloaded) {
    throw new Error(`VOD ${vodId} not downloaded yet`);
  }

  if (
    vod.processed &&
    vod.processed_file_path &&
    existsSync(vod.processed_file_path)
  ) {
    console.log(`VOD ${vodId} already processed`);
    db.prepare('UPDATE vods SET process_status = ? WHERE id = ?').run(
      'completed',
      vodId
    );
    return vod.processed_file_path;
  }

  broadcastStatus({ type: 'process_start', vodId, title: vod.title });

  db.prepare('UPDATE vods SET process_status = ? WHERE id = ?').run(
    'processing',
    vodId
  );

  try {
    const mutedSegments = JSON.parse(vod.muted_segments || '[]');
    const outputPath = join(PROCESSED_STORAGE, `${vodId}_processed.mp4`);

    if (mutedSegments.length === 0) {
      const { copyFileSync } = await import('fs');
      copyFileSync(vod.file_path, outputPath);

      db.prepare(
        'UPDATE vods SET processed = 1, process_status = ?, processed_file_path = ?, error_message = NULL WHERE id = ?'
      ).run('completed', outputPath, vodId);

      broadcastStatus({ type: 'process_complete', vodId, title: vod.title });
      return outputPath;
    }

    const totalDuration = parseDuration(vod.duration);
    const keepSegments = [];
    let lastEnd = 0;

    for (const segment of mutedSegments) {
      if (segment.offset > lastEnd) {
        keepSegments.push({
          start: lastEnd,
          end: segment.offset,
        });
      }
      lastEnd = segment.offset + segment.duration;
    }

    if (lastEnd < totalDuration) {
      keepSegments.push({
        start: lastEnd,
        end: totalDuration,
      });
    }

    const segmentFiles = [];

    for (let i = 0; i < keepSegments.length; i++) {
      const segment = keepSegments[i];
      const segmentPath = join(PROCESSED_STORAGE, `${vodId}_segment_${i}.mp4`);

      await new Promise((resolve, reject) => {
        ffmpeg(vod.file_path)
          .setStartTime(segment.start)
          .setDuration(segment.end - segment.start)
          .outputOptions('-c copy')
          .output(segmentPath)
          .on('end', () => {
            segmentFiles.push(segmentPath);
            resolve();
          })
          .on('error', reject)
          .run();
      });

      broadcastStatus({
        type: 'process_progress',
        vodId,
        segment: i + 1,
        total: keepSegments.length,
      });
    }

    const concatListPath = join(PROCESSED_STORAGE, `${vodId}_concat.txt`);
    const { writeFileSync, unlinkSync } = await import('fs');
    writeFileSync(
      concatListPath,
      segmentFiles.map((f) => `file '${f}'`).join('\n')
    );

    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(concatListPath)
        .inputOptions('-f concat', '-safe 0')
        .outputOptions('-c copy')
        .output(outputPath)
        .on('end', () => {
          segmentFiles.forEach((f) => unlinkSync(f));
          unlinkSync(concatListPath);
          resolve();
        })
        .on('error', reject)
        .run();
    });

    db.prepare(
      'UPDATE vods SET processed = 1, process_status = ?, processed_file_path = ?, error_message = NULL WHERE id = ?'
    ).run('completed', outputPath, vodId);

    broadcastStatus({ type: 'process_complete', vodId, title: vod.title });
    return outputPath;
  } catch (error) {
    db.prepare(
      'UPDATE vods SET process_status = ?, error_message = ? WHERE id = ?'
    ).run('failed', error.message, vodId);

    broadcastStatus({ type: 'process_error', vodId, error: error.message });
    throw error;
  }
}

