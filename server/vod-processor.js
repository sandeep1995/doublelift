import { spawn } from 'child_process';
import { existsSync, mkdirSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import ffmpeg from 'fluent-ffmpeg';
import { getDatabase } from './database.js';
import { getMutedSegments } from './twitch-api.js';
import { broadcastStatus } from './websocket.js';
import readline from 'readline';

function toFfmpegPath(filePath) {
  return filePath.replace(/\\/g, '/');
}
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

      const isWindows = process.platform === 'win32';
      const twitchDl = spawn('twitch-dl', args, {
        cwd: VOD_STORAGE,
        env: { ...process.env },
        shell: isWindows,
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
  progressCallback = null,
  opts = {}
) {
  const {
    noiseDb = -30,
    minSilence = 5,
    minSegment = 10,
    mergeGap = 2,
    log = true,
  } = opts;

  const logIt = (...args) => log && console.log(...args);

  logIt(`[Mute Detection] Starting ffmpeg mute detection for: ${videoPath}`);
  if (videoDuration)
    logIt(`[Mute Detection] Video duration (given): ${videoDuration}s`);

  const isWindows = process.platform === 'win32';

  const probeDuration = () =>
    new Promise((resolve) => {
      const p = spawn('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        videoPath,
      ], { shell: isWindows });
      let out = '';
      p.stdout.on('data', (d) => (out += d.toString()));
      p.on('close', () => {
        const dur = Number(out.trim());
        resolve(Number.isFinite(dur) ? dur : null);
      });
      p.on('error', () => resolve(null));
    });

  let detectedDuration = videoDuration ?? (await probeDuration());
  if (detectedDuration) {
    logIt(
      `[Mute Detection] Detected duration: ${detectedDuration.toFixed(3)}s`
    );
  }

  const mergeSegments = (segments, minDuration = minSegment) => {
    if (!segments.length) return [];
    const sorted = [...segments].sort((a, b) => a.offset - b.offset);
    const merged = [{ ...sorted[0] }];

    for (let i = 1; i < sorted.length; i++) {
      const prev = merged[merged.length - 1];
      const cur = sorted[i];
      const prevEnd = prev.offset + prev.duration;
      const gap = cur.offset - prevEnd;

      if (gap <= mergeGap) {
        const newEnd = Math.max(prevEnd, cur.offset + cur.duration);
        prev.duration = newEnd - prev.offset;
      } else {
        merged.push({ ...cur });
      }
    }

    return merged.filter((seg) => seg.duration >= minDuration);
  };

  return new Promise((resolve, reject) => {
    let output = '';
    let errorOutput = '';
    const mutedSegments = [];
    let currentSilenceStart = null;

    const ffmpegProcess = spawn('ffmpeg', [
      '-hide_banner',
      '-nostdin',
      '-vn',
      '-i',
      videoPath,
      '-af',
      `silencedetect=noise=${noiseDb}dB:duration=${minSilence}`,
      '-f',
      'null',
      isWindows ? 'NUL' : '-',
    ], { shell: isWindows });

    const rl = readline.createInterface({ input: ffmpegProcess.stderr });

    rl.on('line', (line) => {
      output += line + '\n';
      errorOutput += line + '\n';

      // fallback duration parse if ffprobe failed
      if (!detectedDuration) {
        const dm = line.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
        if (dm) {
          const h = parseInt(dm[1], 10);
          const m = parseInt(dm[2], 10);
          const s = parseInt(dm[3], 10);
          const cs = parseInt(dm[4], 10);
          detectedDuration = h * 3600 + m * 60 + s + cs / 100;
          logIt(
            `[Mute Detection] Duration from ffmpeg: ${detectedDuration.toFixed(
              3
            )}s`
          );
          progressCallback?.({
            stage: 'detecting',
            detectedDuration,
            segmentsFound: mutedSegments.length,
          });
        }
      }

      // multiple events per line -> use global regex loops
      const startRe = /silence_start:\s*([\d.]+)/g;
      const endRe = /silence_end:\s*([\d.]+)/g;

      let match;

      while ((match = startRe.exec(line))) {
        currentSilenceStart = parseFloat(match[1]);
        logIt(
          `[Mute Detection] Silence start at ${currentSilenceStart.toFixed(3)}s`
        );
      }

      while ((match = endRe.exec(line))) {
        const silenceEnd = parseFloat(match[1]);
        if (currentSilenceStart == null) continue;

        const duration = silenceEnd - currentSilenceStart;
        if (duration >= minSegment) {
          mutedSegments.push({
            offset: currentSilenceStart,
            duration,
          });

          logIt(
            `[Mute Detection] Silence segment: ${currentSilenceStart.toFixed(
              3
            )}s - ${silenceEnd.toFixed(3)}s (dur ${duration.toFixed(3)}s)`
          );

          progressCallback?.({
            stage: 'detecting',
            segmentsFound: mutedSegments.length,
            latestSegment: {
              offset: currentSilenceStart,
              duration,
              end: silenceEnd,
            },
          });
        }

        currentSilenceStart = null;
      }
    });

    ffmpegProcess.on('close', (code) => {
      rl.close();

      // ffmpeg exits with 1 when using -f null, which is normal
      if (code === 0 || code === 1) {
        // handle silence continuing to end
        if (currentSilenceStart != null) {
          const finalDuration = detectedDuration;
          if (finalDuration != null) {
            const duration = finalDuration - currentSilenceStart;
            if (duration >= minSegment) {
              mutedSegments.push({
                offset: currentSilenceStart,
                duration,
              });
              logIt(
                `[Mute Detection] Final silence: ${currentSilenceStart.toFixed(
                  3
                )}s - ${finalDuration.toFixed(3)}s (dur ${duration.toFixed(
                  3
                )}s)`
              );
            }
          }
        }

        const merged = mergeSegments(mutedSegments);

        logIt(
          `[Mute Detection] Detection complete. Found ${merged.length} muted segment(s)`
        );
        if (merged.length) {
          logIt(
            `[Mute Detection] Muted segments:`,
            JSON.stringify(merged, null, 2)
          );
        }

        progressCallback?.({
          stage: 'complete',
          segmentsFound: merged.length,
          totalSegments: merged.length,
        });

        resolve(merged);
      } else {
        console.error(`[Mute Detection] Failed with exit code ${code}`);
        reject(
          new Error(
            `ffmpeg silencedetect failed with code ${code}.\nOutput:\n${output}\nError:\n${errorOutput}`
          )
        );
      }
    });

    ffmpegProcess.on('error', (err) => {
      console.error(`[Mute Detection] Process error:`, err);
      if (err.code === 'ENOENT') {
        reject(new Error('ffmpeg/ffprobe not found. Please install ffmpeg.'));
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

  db.prepare(
    'UPDATE vods SET process_status = ?, process_progress = 0 WHERE id = ?'
  ).run('processing', vodId);

  try {
    const MIN_MUTE_DURATION = 10;
    let mutedSegments = JSON.parse(vod.muted_segments || '[]');
    const outputPath = resolve(PROCESSED_STORAGE, `${vodId}_processed.mp4`);

    mutedSegments = mutedSegments.filter(
      (seg) => seg.duration >= MIN_MUTE_DURATION
    );

    if (
      mutedSegments.length === 0 &&
      vod.file_path &&
      existsSync(vod.file_path)
    ) {
      console.log(
        `No muted segments from Twitch API for VOD ${vodId}, detecting with ffmpeg...`
      );
      db.prepare('UPDATE vods SET process_progress = ? WHERE id = ?').run(
        10,
        vodId
      );
      broadcastStatus({
        type: 'process_progress',
        vodId,
        percent: 10,
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

        db.prepare(
          'UPDATE vods SET muted_segments = ?, process_progress = ? WHERE id = ?'
        ).run(JSON.stringify(mutedSegments), 30, vodId);
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
        'UPDATE vods SET processed = 1, process_status = ?, process_progress = 100, processed_file_path = ?, error_message = NULL WHERE id = ?'
      ).run('completed', outputPath, vodId);

      broadcastStatus({ type: 'process_complete', vodId, title: vod.title });
      return outputPath;
    }

    const totalDuration = parseDuration(vod.duration);
    const MIN_KEEP_DURATION = 5;

    mutedSegments.sort((a, b) => a.offset - b.offset);

    const allKeepSegments = [];
    let lastEnd = 0;

    for (const segment of mutedSegments) {
      if (segment.offset > lastEnd) {
        allKeepSegments.push({
          start: lastEnd,
          end: segment.offset,
        });
      }
      lastEnd = segment.offset + segment.duration;
    }

    if (lastEnd < totalDuration) {
      allKeepSegments.push({
        start: lastEnd,
        end: totalDuration,
      });
    }

    const keepSegments = allKeepSegments.filter(
      (seg) => seg.end - seg.start >= MIN_KEEP_DURATION
    );

    console.log(
      `VOD ${vodId}: ${mutedSegments.length} muted segments, ${keepSegments.length} segments to keep`
    );

    if (keepSegments.length === 0) {
      console.log(
        `VOD ${vodId}: No segments to keep after filtering, copying original`
      );
      const { copyFileSync } = await import('fs');
      copyFileSync(vod.file_path, outputPath);

      db.prepare(
        'UPDATE vods SET processed = 1, process_status = ?, process_progress = 100, processed_file_path = ?, error_message = NULL WHERE id = ?'
      ).run('completed', outputPath, vodId);

      broadcastStatus({ type: 'process_complete', vodId, title: vod.title });
      return outputPath;
    }

    if (keepSegments.length === 1) {
      const segment = keepSegments[0];
      const isFullFile = segment.start < 1 && segment.end >= totalDuration - 1;

      if (isFullFile) {
        console.log(
          `VOD ${vodId}: Single segment is full file, copying original`
        );
        const { copyFileSync } = await import('fs');
        copyFileSync(vod.file_path, outputPath);
      } else {
        console.log(
          `VOD ${vodId}: Extracting single segment ${segment.start.toFixed(
            1
          )}s - ${segment.end.toFixed(1)}s`
        );
        db.prepare('UPDATE vods SET process_progress = ? WHERE id = ?').run(
          50,
          vodId
        );
        broadcastStatus({
          type: 'process_progress',
          vodId,
          stage: 'extracting_segments',
          percent: 50,
          message: `Extracting segment (${segment.start.toFixed(
            1
          )}s - ${segment.end.toFixed(1)}s)`,
          segment: 1,
          total: 1,
        });

        await new Promise((resolvePromise, reject) => {
          ffmpeg(vod.file_path)
            .setStartTime(segment.start)
            .setDuration(segment.end - segment.start)
            .outputOptions('-c copy')
            .output(outputPath)
            .on('end', resolvePromise)
            .on('error', reject)
            .run();
        });
      }

      db.prepare(
        'UPDATE vods SET processed = 1, process_status = ?, process_progress = 100, processed_file_path = ?, error_message = NULL WHERE id = ?'
      ).run('completed', outputPath, vodId);

      broadcastStatus({ type: 'process_complete', vodId, title: vod.title });
      return outputPath;
    }

    db.prepare('UPDATE vods SET process_progress = ? WHERE id = ?').run(
      30,
      vodId
    );

    broadcastStatus({
      type: 'process_progress',
      vodId,
      stage: 'extracting_segments',
      percent: 30,
      message: `Extracting ${keepSegments.length} segment(s) from video...`,
      segment: 0,
      total: keepSegments.length,
    });

    const segmentFiles = [];
    const { writeFileSync, unlinkSync } = await import('fs');

    for (let i = 0; i < keepSegments.length; i++) {
      const segment = keepSegments[i];
      const segmentPath = resolve(
        PROCESSED_STORAGE,
        `${vodId}_segment_${i}.mp4`
      );

      await new Promise((resolvePromise, reject) => {
        ffmpeg(vod.file_path)
          .setStartTime(segment.start)
          .setDuration(segment.end - segment.start)
          .outputOptions('-c copy')
          .output(segmentPath)
          .on('end', () => {
            segmentFiles.push(segmentPath);
            resolvePromise();
          })
          .on('error', reject)
          .run();
      });

      const progress = Math.round(30 + ((i + 1) / keepSegments.length) * 60);
      db.prepare('UPDATE vods SET process_progress = ? WHERE id = ?').run(
        progress,
        vodId
      );

      broadcastStatus({
        type: 'process_progress',
        vodId,
        stage: 'extracting_segments',
        percent: progress,
        message: `Extracted segment ${i + 1}/${
          keepSegments.length
        } (${segment.start.toFixed(1)}s - ${segment.end.toFixed(1)}s)`,
        segment: i + 1,
        total: keepSegments.length,
      });
    }

    db.prepare('UPDATE vods SET process_progress = ? WHERE id = ?').run(
      95,
      vodId
    );

    broadcastStatus({
      type: 'process_progress',
      vodId,
      stage: 'concatenating',
      percent: 95,
      message: 'Concatenating segments...',
    });

    const concatListPath = resolve(PROCESSED_STORAGE, `${vodId}_concat.txt`);

    const absoluteSegmentFiles = segmentFiles.map((f) => toFfmpegPath(resolve(f)));
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
      'UPDATE vods SET processed = 1, process_status = ?, process_progress = 100, processed_file_path = ?, error_message = NULL WHERE id = ?'
    ).run('completed', outputPath, vodId);

    broadcastStatus({ type: 'process_complete', vodId, title: vod.title });
    return outputPath;
  } catch (error) {
    db.prepare(
      'UPDATE vods SET process_status = ?, process_progress = 0, error_message = ? WHERE id = ?'
    ).run('failed', error.message, vodId);

    broadcastStatus({ type: 'process_error', vodId, error: error.message });
    throw error;
  }
}
