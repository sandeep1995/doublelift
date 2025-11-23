import { spawn } from 'child_process';
import { existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import ffmpeg from 'fluent-ffmpeg';
import { getDatabase } from './database.js';
import { getMutedSegments } from './twitch-api.js';
import { broadcastStatus } from './websocket.js';

const VOD_STORAGE = process.env.VOD_STORAGE_PATH || './vods';
const PROCESSED_STORAGE = process.env.PROCESSED_STORAGE_PATH || './processed';

if (!existsSync(VOD_STORAGE)) mkdirSync(VOD_STORAGE, { recursive: true });
if (!existsSync(PROCESSED_STORAGE))
  mkdirSync(PROCESSED_STORAGE, { recursive: true });


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
    const outputPath = join(VOD_STORAGE, `${vodId}.mp4`);

    await new Promise((resolve, reject) => {
      let output = '';
      let lastPercent = 0;

      // Use twitch-dl to download the VOD
      // twitch-dl downloads to the current directory, so we change to VOD_STORAGE
      const twitchDl = spawn('twitch-dl', ['download', vodId], {
        cwd: VOD_STORAGE,
      });

      twitchDl.stdout.on('data', (data) => {
        output += data.toString();
        console.log(`twitch-dl: ${data.toString()}`);

        // Try to parse progress from output
        // twitch-dl outputs progress like: "Downloading: 45%"
        const progressMatch = output.match(/(\d+)%/);
        if (progressMatch) {
          const percent = parseInt(progressMatch[1]);
          if (percent !== lastPercent && percent >= 0 && percent <= 100) {
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
      });

      twitchDl.stderr.on('data', (data) => {
        output += data.toString();
        console.error(`twitch-dl stderr: ${data.toString()}`);
      });

      twitchDl.on('close', (code) => {
        if (code === 0) {
          console.log(`Downloaded VOD ${vodId} using twitch-dl`);
          resolve();
        } else {
          reject(
            new Error(
              `twitch-dl exited with code ${code}. Output: ${output}`
            )
          );
        }
      });

      twitchDl.on('error', (err) => {
        if (err.code === 'ENOENT') {
          reject(
            new Error(
              'twitch-dl not found. Please install it with: pip install twitch-dl'
            )
          );
        } else {
          reject(err);
        }
      });
    });

    // Find the downloaded file (twitch-dl may create a different filename)
    const files = readdirSync(VOD_STORAGE);
    const downloadedFile = files.find(
      (file) => file.includes(vodId) && file.endsWith('.mp4')
    );

    if (!downloadedFile) {
      throw new Error(
        `Downloaded file not found in ${VOD_STORAGE}. Files: ${files.join(', ')}`
      );
    }

    const actualOutputPath = join(VOD_STORAGE, downloadedFile);

    // Rename to our expected filename if different
    if (downloadedFile !== `${vodId}.mp4`) {
      const { renameSync } = await import('fs');
      renameSync(actualOutputPath, outputPath);
    }

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

