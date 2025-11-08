import { spawn } from 'child_process';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import axios from 'axios';
import ffmpeg from 'fluent-ffmpeg';
import { getDatabase } from './database.js';
import { getMutedSegments } from './twitch-api.js';
import { broadcastStatus } from './websocket.js';

const VOD_STORAGE = process.env.VOD_STORAGE_PATH || './vods';
const PROCESSED_STORAGE = process.env.PROCESSED_STORAGE_PATH || './processed';

if (!existsSync(VOD_STORAGE)) mkdirSync(VOD_STORAGE, { recursive: true });
if (!existsSync(PROCESSED_STORAGE))
  mkdirSync(PROCESSED_STORAGE, { recursive: true });

async function getVodDownloadUrl(vodId) {
  const token = await getAccessToken();

  const response = await axios.get(`https://api.twitch.tv/v5/videos/${vodId}`, {
    headers: {
      'Client-ID': process.env.TWITCH_CLIENT_ID,
      Accept: 'application/vnd.twitchtv.v5+json',
    },
  });

  const previewUrl = response.data.preview?.template;
  if (!previewUrl) {
    throw new Error('Could not find VOD preview URL');
  }

  const baseUrl = previewUrl.split('/storyboards/')[0];
  return `${baseUrl}/chunked/index-dvr.m3u8`;
}

export async function downloadVod(vodId) {
  const db = getDatabase();
  const vod = db.prepare('SELECT * FROM vods WHERE id = ?').get(vodId);

  if (!vod) {
    throw new Error(`VOD ${vodId} not found in database`);
  }

  if (vod.downloaded) {
    console.log(`VOD ${vodId} already downloaded`);
    return vod.file_path;
  }

  broadcastStatus({ type: 'download_start', vodId, title: vod.title });

  try {
    const m3u8Url = await getVodDownloadUrl(vodId);
    const outputPath = join(VOD_STORAGE, `${vodId}.mp4`);

    await new Promise((resolve, reject) => {
      ffmpeg(m3u8Url)
        .outputOptions('-c copy')
        .output(outputPath)
        .on('progress', (progress) => {
          if (progress.percent) {
            broadcastStatus({
              type: 'download_progress',
              vodId,
              percent: Math.round(progress.percent),
            });
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
      'UPDATE vods SET downloaded = 1, file_path = ? WHERE id = ?'
    ).run(outputPath, vodId);

    broadcastStatus({ type: 'download_complete', vodId });
    return outputPath;
  } catch (error) {
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

  if (vod.processed) {
    console.log(`VOD ${vodId} already processed`);
    return vod.processed_file_path;
  }

  broadcastStatus({ type: 'process_start', vodId, title: vod.title });

  try {
    const mutedSegments = JSON.parse(vod.muted_segments || '[]');
    const outputPath = join(PROCESSED_STORAGE, `${vodId}_processed.mp4`);

    if (mutedSegments.length === 0) {
      const { copyFileSync } = await import('fs');
      copyFileSync(vod.file_path, outputPath);

      db.prepare(
        'UPDATE vods SET processed = 1, processed_file_path = ? WHERE id = ?'
      ).run(outputPath, vodId);

      broadcastStatus({ type: 'process_complete', vodId });
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
      'UPDATE vods SET processed = 1, processed_file_path = ? WHERE id = ?'
    ).run(outputPath, vodId);

    broadcastStatus({ type: 'process_complete', vodId });
    return outputPath;
  } catch (error) {
    broadcastStatus({ type: 'process_error', vodId, error: error.message });
    throw error;
  }
}

async function getAccessToken() {
  const axios = (await import('axios')).default;
  const response = await axios.post('https://id.twitch.tv/oauth2/token', null, {
    params: {
      client_id: process.env.TWITCH_CLIENT_ID,
      client_secret: process.env.TWITCH_CLIENT_SECRET,
      grant_type: 'client_credentials',
    },
  });
  return response.data.access_token;
}
