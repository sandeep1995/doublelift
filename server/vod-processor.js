import { spawn } from 'child_process';
import { existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import ffmpeg from 'fluent-ffmpeg';
import { getDatabase } from './database.js';
import { getMutedSegments } from './twitch-api.js';
import { broadcastStatus } from './websocket.js';

const VOD_STORAGE = process.env.VOD_STORAGE_PATH || './vods';
const PROCESSED_STORAGE = process.env.PROCESSED_STORAGE_PATH || './processed';
const CACHE_DIR = process.env.TWITCH_DL_CACHE_DIR || join(VOD_STORAGE, '.cache');
const DOWNLOAD_QUALITY = process.env.DOWNLOAD_QUALITY || 'source';
const DOWNLOAD_FORMAT = process.env.DOWNLOAD_FORMAT || 'mp4';
const DOWNLOAD_RATE_LIMIT = process.env.DOWNLOAD_RATE_LIMIT || null;
const TWITCH_AUTH_TOKEN = process.env.TWITCH_AUTH_TOKEN || null;

if (!existsSync(VOD_STORAGE)) mkdirSync(VOD_STORAGE, { recursive: true });
if (!existsSync(PROCESSED_STORAGE))
  mkdirSync(PROCESSED_STORAGE, { recursive: true });
if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });


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
    // Use a predictable filename format: {id}.{format}
    const outputFilename = `${vodId}.${DOWNLOAD_FORMAT}`;
    const outputPath = join(VOD_STORAGE, outputFilename);

    // Build twitch-dl command arguments
    const args = [
      'download',
      vodId,
      '--quality',
      DOWNLOAD_QUALITY,
      '--format',
      DOWNLOAD_FORMAT,
      '--output',
      outputFilename,
      '--skip-existing',
      '--cache-dir',
      join(CACHE_DIR, vodId),
    ];

    // Add authentication token if available (for subscriber-only VODs)
    if (TWITCH_AUTH_TOKEN) {
      args.push('--auth-token', TWITCH_AUTH_TOKEN);
    }

    // Add rate limit if configured
    if (DOWNLOAD_RATE_LIMIT) {
      args.push('--rate-limit', DOWNLOAD_RATE_LIMIT);
    }

    await new Promise((resolve, reject) => {
      let output = '';
      let lastPercent = 0;
      let errorOutput = '';
      let lastProgressUpdate = 0;

      // Function to parse detailed progress from twitch-dl output
      const parseProgress = (text) => {
        const progress = {
          percent: null,
          vodsCount: null,
          totalVods: null,
          totalSize: null,
          speed: null,
          eta: null,
        };

        // Parse percentage: "1%" or "Downloaded 27/2005 VODs 1%"
        const percentMatch = text.match(/(\d+)%/);
        if (percentMatch) {
          progress.percent = parseInt(percentMatch[1]);
        }

        // Parse VODs count: "Downloaded 27/2005 VODs"
        const vodsMatch = text.match(/Downloaded\s+(\d+)\/(\d+)\s+VODs/i);
        if (vodsMatch) {
          progress.vodsCount = parseInt(vodsMatch[1]);
          progress.totalVods = parseInt(vodsMatch[2]);
        }

        // Parse total size: "of ~18.4GB" or "18.4GB"
        const sizeMatch = text.match(/of\s+~?([\d.]+)\s*(GB|MB|KB|TB)/i);
        if (sizeMatch) {
          progress.totalSize = `${sizeMatch[1]}${sizeMatch[2].toUpperCase()}`;
        }

        // Parse speed: "at 31.2MB/s" or "31.2MB/s"
        const speedMatch = text.match(/at\s+([\d.]+)\s*(GB|MB|KB|TB)\/s/i);
        if (speedMatch) {
          progress.speed = `${speedMatch[1]}${speedMatch[2].toUpperCase()}/s`;
        }

        // Parse ETA: "ETA 09:54" or "09:54"
        const etaMatch = text.match(/ETA\s+(\d{1,2}:\d{2})/i);
        if (etaMatch) {
          progress.eta = etaMatch[1];
        }

        return progress;
      };

      // Use twitch-dl to download the VOD
      const twitchDl = spawn('twitch-dl', args, {
        cwd: VOD_STORAGE,
        env: { ...process.env },
      });

      const handleProgressData = (dataStr, isStderr = false) => {
        const progress = parseProgress(dataStr);

        // Update if we have new percentage
        if (progress.percent !== null && progress.percent !== lastPercent) {
          lastPercent = progress.percent;
          db.prepare(
            'UPDATE vods SET download_progress = ? WHERE id = ?'
          ).run(progress.percent, vodId);
        }

        // Broadcast detailed progress (throttle to once per second)
        const now = Date.now();
        if (now - lastProgressUpdate > 1000 || progress.percent !== null) {
          lastProgressUpdate = now;

          const progressData = {
            type: 'download_progress',
            vodId,
            percent: progress.percent !== null ? progress.percent : lastPercent,
            vodsCount: progress.vodsCount,
            totalVods: progress.totalVods,
            totalSize: progress.totalSize,
            speed: progress.speed,
            eta: progress.eta,
            logLine: dataStr.trim(),
          };

          broadcastStatus(progressData);
        }
      };

      twitchDl.stdout.on('data', (data) => {
        const dataStr = data.toString();
        output += dataStr;
        console.log(`twitch-dl: ${dataStr}`);
        handleProgressData(dataStr, false);
      });

      twitchDl.stderr.on('data', (data) => {
        const dataStr = data.toString();
        errorOutput += dataStr;
        output += dataStr;
        console.error(`twitch-dl stderr: ${dataStr}`);
        handleProgressData(dataStr, true);
      });

      twitchDl.on('close', (code) => {
        if (code === 0) {
          console.log(`Downloaded VOD ${vodId} using twitch-dl`);
          resolve();
        } else {
          // Check if file exists despite non-zero exit code (might be skip-existing)
          if (existsSync(outputPath)) {
            console.log(
              `VOD ${vodId} file exists despite exit code ${code}, treating as success`
            );
            resolve();
          } else {
            reject(
              new Error(
                `twitch-dl exited with code ${code}. Output: ${output}\nError: ${errorOutput}`
              )
            );
          }
        }
      });

      twitchDl.on('error', (err) => {
        if (err.code === 'ENOENT') {
          reject(
            new Error(
              'twitch-dl not found. Please install it with: pip install twitch-dl or pipx install twitch-dl'
            )
          );
        } else {
          reject(err);
        }
      });
    });

    // Verify the file was downloaded
    if (!existsSync(outputPath)) {
      // Fallback: try to find any file with the VOD ID
      const files = readdirSync(VOD_STORAGE);
      const downloadedFile = files.find(
        (file) => file.includes(vodId) && (file.endsWith(`.${DOWNLOAD_FORMAT}`) || file.endsWith('.mp4') || file.endsWith('.ts'))
      );

      if (downloadedFile) {
        const actualOutputPath = join(VOD_STORAGE, downloadedFile);
        const { renameSync } = await import('fs');
        renameSync(actualOutputPath, outputPath);
        console.log(`Renamed ${downloadedFile} to ${outputFilename}`);
      } else {
        throw new Error(
          `Downloaded file not found at ${outputPath}. Files in directory: ${files.join(', ')}`
        );
      }
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

