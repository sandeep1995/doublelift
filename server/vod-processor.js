import { spawn } from 'child_process';
import { existsSync, mkdirSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import ffmpeg from 'fluent-ffmpeg';
import { getDatabase } from './database.js';
import { getMutedSegments } from './twitch-api.js';
import { broadcastStatus } from './websocket.js';

const VOD_STORAGE = process.env.VOD_STORAGE_PATH || './vods';
const PROCESSED_STORAGE = process.env.PROCESSED_STORAGE_PATH || './processed';
const CACHE_DIR =
  process.env.TWITCH_DL_CACHE_DIR || join(VOD_STORAGE, '.cache');
const DOWNLOAD_QUALITY = process.env.DOWNLOAD_QUALITY || 'source';
const DOWNLOAD_FORMAT = process.env.DOWNLOAD_FORMAT || 'mp4';
const DOWNLOAD_RATE_LIMIT = process.env.DOWNLOAD_RATE_LIMIT || null;
const TWITCH_AUTH_TOKEN = process.env.TWITCH_AUTH_TOKEN || null;

if (!existsSync(VOD_STORAGE)) mkdirSync(VOD_STORAGE, { recursive: true });
if (!existsSync(PROCESSED_STORAGE))
  mkdirSync(PROCESSED_STORAGE, { recursive: true });
if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });

// Store active download processes
downloadVod.activeProcesses = new Map();

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

    const downloadPromise = new Promise((resolve, reject) => {
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

      // Store process reference for cancellation immediately
      downloadVod.activeProcesses.set(vodId, twitchDl);

      const handleProgressData = (dataStr, isStderr = false) => {
        const progress = parseProgress(dataStr);

        // Update if we have new percentage
        if (progress.percent !== null && progress.percent !== lastPercent) {
          lastPercent = progress.percent;
          db.prepare('UPDATE vods SET download_progress = ? WHERE id = ?').run(
            progress.percent,
            vodId
          );
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
        // Clean up process reference
        if (downloadVod.activeProcesses) {
          downloadVod.activeProcesses.delete(vodId);
        }

        if (code === 0) {
          console.log(`Downloaded VOD ${vodId} using twitch-dl`);
          resolve();
        } else if (code === 143 || code === 15) {
          // SIGTERM (143) or SIGTERM (15) - process was killed
          reject(new Error('Download cancelled'));
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
        // Clean up process reference
        if (downloadVod.activeProcesses) {
          downloadVod.activeProcesses.delete(vodId);
        }

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

    await downloadPromise;

    // Verify the file was downloaded
    if (!existsSync(outputPath)) {
      // Fallback: try to find any file with the VOD ID
      const files = readdirSync(VOD_STORAGE);
      const downloadedFile = files.find(
        (file) =>
          file.includes(vodId) &&
          (file.endsWith(`.${DOWNLOAD_FORMAT}`) ||
            file.endsWith('.mp4') ||
            file.endsWith('.ts'))
      );

      if (downloadedFile) {
        const actualOutputPath = join(VOD_STORAGE, downloadedFile);
        const { renameSync } = await import('fs');
        renameSync(actualOutputPath, outputPath);
        console.log(`Renamed ${downloadedFile} to ${outputFilename}`);
      } else {
        throw new Error(
          `Downloaded file not found at ${outputPath}. Files in directory: ${files.join(
            ', '
          )}`
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

async function detectMutedSegmentsWithFfmpeg(
  videoPath,
  videoDuration = null,
  progressCallback = null
) {
  console.log(
    `[Mute Detection] Starting ffmpeg mute detection for: ${videoPath}`
  );
  if (videoDuration) {
    console.log(`[Mute Detection] Video duration: ${videoDuration}s`);
  }

  return new Promise((resolve, reject) => {
    let output = '';
    let errorOutput = '';
    const mutedSegments = [];
    let currentSilenceStart = null;
    let detectedDuration = null;

    const ffmpegProcess = spawn('ffmpeg', [
      '-i',
      videoPath,
      '-af',
      'silencedetect=noise=-30dB:duration=0.5',
      '-f',
      'null',
      '-',
    ]);

    ffmpegProcess.stderr.on('data', (data) => {
      const dataStr = data.toString();
      errorOutput += dataStr;
      output += dataStr;

      // Parse video duration from ffmpeg output
      // Format: Duration: 01:23:45.67
      if (!detectedDuration) {
        const durationMatch = dataStr.match(
          /Duration:\s*(\d{2}):(\d{2}):(\d{2})\.(\d{2})/
        );
        if (durationMatch) {
          const hours = parseInt(durationMatch[1]);
          const minutes = parseInt(durationMatch[2]);
          const seconds = parseInt(durationMatch[3]);
          const centiseconds = parseInt(durationMatch[4]);
          detectedDuration =
            hours * 3600 + minutes * 60 + seconds + centiseconds / 100;
          console.log(
            `[Mute Detection] Detected video duration: ${detectedDuration}s`
          );
          if (progressCallback) {
            progressCallback({
              stage: 'detecting',
              detectedDuration,
              segmentsFound: mutedSegments.length,
            });
          }
        }
      }

      // Parse silencedetect output
      // Format: [silencedetect @ 0x...] silence_start: 10.5
      //         [silencedetect @ 0x...] silence_end: 15.2 | silence_duration: 4.7
      const silenceStartMatch = dataStr.match(/silence_start:\s*([\d.]+)/);
      const silenceEndMatch = dataStr.match(/silence_end:\s*([\d.]+)/);

      if (silenceStartMatch) {
        currentSilenceStart = parseFloat(silenceStartMatch[1]);
        console.log(
          `[Mute Detection] Silence detected starting at ${currentSilenceStart.toFixed(
            2
          )}s`
        );
      }

      if (silenceEndMatch && currentSilenceStart !== null) {
        const silenceEnd = parseFloat(silenceEndMatch[1]);
        const duration = silenceEnd - currentSilenceStart;

        mutedSegments.push({
          offset: currentSilenceStart,
          duration: duration,
        });

        console.log(
          `[Mute Detection] Silence segment found: ${currentSilenceStart.toFixed(
            2
          )}s - ${silenceEnd.toFixed(2)}s (duration: ${duration.toFixed(2)}s)`
        );
        console.log(
          `[Mute Detection] Total muted segments so far: ${mutedSegments.length}`
        );

        if (progressCallback) {
          progressCallback({
            stage: 'detecting',
            segmentsFound: mutedSegments.length,
            latestSegment: {
              offset: currentSilenceStart,
              duration: duration,
              end: silenceEnd,
            },
          });
        }

        currentSilenceStart = null;
      }
    });

    ffmpegProcess.on('close', (code) => {
      // ffmpeg exits with code 1 when using -f null, which is normal
      if (code === 0 || code === 1) {
        // Handle unclosed silence (silence that continues to end of video)
        if (currentSilenceStart !== null) {
          const finalDuration = videoDuration || detectedDuration;
          if (finalDuration) {
            const duration = finalDuration - currentSilenceStart;
            mutedSegments.push({
              offset: currentSilenceStart,
              duration: duration,
            });
            console.log(
              `[Mute Detection] Final silence segment (to end): ${currentSilenceStart.toFixed(
                2
              )}s - ${finalDuration.toFixed(2)}s (duration: ${duration.toFixed(
                2
              )}s)`
            );
          }
        }
        console.log(
          `[Mute Detection] Detection complete. Found ${mutedSegments.length} muted segment(s)`
        );
        if (mutedSegments.length > 0) {
          console.log(
            `[Mute Detection] Muted segments:`,
            JSON.stringify(mutedSegments, null, 2)
          );
        }
        if (progressCallback) {
          progressCallback({
            stage: 'complete',
            segmentsFound: mutedSegments.length,
            totalSegments: mutedSegments.length,
          });
        }
        resolve(mutedSegments);
      } else {
        console.error(`[Mute Detection] Failed with exit code ${code}`);
        console.error(`[Mute Detection] Output: ${output}`);
        console.error(`[Mute Detection] Error: ${errorOutput}`);
        reject(
          new Error(
            `ffmpeg silencedetect failed with code ${code}. Output: ${output}\nError: ${errorOutput}`
          )
        );
      }
    });

    ffmpegProcess.on('error', (err) => {
      console.error(`[Mute Detection] Process error:`, err);
      if (err.code === 'ENOENT') {
        reject(new Error('ffmpeg not found. Please install ffmpeg.'));
      } else {
        reject(err);
      }
    });
  });
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
    let mutedSegments = JSON.parse(vod.muted_segments || '[]');
    const outputPath = resolve(PROCESSED_STORAGE, `${vodId}_processed.mp4`);

    // If muted_segments is null or empty, try to detect mutes using ffmpeg
    if (
      mutedSegments.length === 0 &&
      vod.file_path &&
      existsSync(vod.file_path)
    ) {
      console.log(
        `No muted segments from Twitch API for VOD ${vodId}, detecting with ffmpeg...`
      );
      broadcastStatus({
        type: 'process_progress',
        vodId,
        message: 'Detecting muted segments with ffmpeg...',
      });

      try {
        const totalDuration = parseDuration(vod.duration);
        mutedSegments = await detectMutedSegmentsWithFfmpeg(
          vod.file_path,
          totalDuration,
          (progress) => {
            broadcastStatus({
              type: 'process_progress',
              vodId,
              stage: 'mute_detection',
              message:
                progress.stage === 'complete'
                  ? `Mute detection complete: Found ${progress.segmentsFound} segment(s)`
                  : progress.latestSegment
                  ? `Found ${
                      progress.segmentsFound
                    } muted segment(s) (latest: ${progress.latestSegment.offset.toFixed(
                      1
                    )}s - ${progress.latestSegment.end.toFixed(1)}s)`
                  : `Detecting muted segments... (${progress.segmentsFound} found so far)`,
              segmentsFound: progress.segmentsFound,
              latestSegment: progress.latestSegment,
            });
          }
        );
        console.log(
          `Detected ${mutedSegments.length} muted segment(s) for VOD ${vodId}`
        );

        // Update database with detected muted segments
        db.prepare('UPDATE vods SET muted_segments = ? WHERE id = ?').run(
          JSON.stringify(mutedSegments),
          vodId
        );
      } catch (error) {
        console.error(
          `Failed to detect muted segments with ffmpeg for VOD ${vodId}:`,
          error.message
        );
        // Continue processing even if detection fails
        mutedSegments = [];
      }
    }

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

    broadcastStatus({
      type: 'process_progress',
      vodId,
      stage: 'extracting_segments',
      message: `Extracting ${keepSegments.length} segment(s) from video...`,
      segment: 0,
      total: keepSegments.length,
    });

    const segmentFiles = [];

    for (let i = 0; i < keepSegments.length; i++) {
      const segment = keepSegments[i];
      const segmentPath = resolve(
        PROCESSED_STORAGE,
        `${vodId}_segment_${i}.mp4`
      );

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
        stage: 'extracting_segments',
        message: `Extracted segment ${i + 1}/${
          keepSegments.length
        } (${segment.start.toFixed(1)}s - ${segment.end.toFixed(1)}s)`,
        segment: i + 1,
        total: keepSegments.length,
      });
    }

    broadcastStatus({
      type: 'process_progress',
      vodId,
      stage: 'concatenating',
      message: 'Concatenating segments...',
    });

    const concatListPath = resolve(PROCESSED_STORAGE, `${vodId}_concat.txt`);
    const { writeFileSync, unlinkSync } = await import('fs');

    // Use absolute paths for segment files in concat list
    const absoluteSegmentFiles = segmentFiles.map((f) => resolve(f));
    writeFileSync(
      concatListPath,
      absoluteSegmentFiles.map((f) => `file '${f}'`).join('\n')
    );

    await new Promise((resolvePromise, reject) => {
      ffmpeg()
        .input(concatListPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions('-c copy')
        .output(outputPath)
        .on('end', () => {
          segmentFiles.forEach((f) => unlinkSync(f));
          unlinkSync(concatListPath);
          resolvePromise();
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
