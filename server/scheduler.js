import cron from 'node-cron';
import { getDatabase } from './database.js';
import { getChannelId, getRecentVods, getMutedSegments } from './twitch-api.js';
import { broadcastStatus } from './websocket.js';
import { downloadQueue } from './download-queue.js';

const AUTO_DOWNLOAD = process.env.AUTO_DOWNLOAD !== 'false';
const SCAN_SCHEDULE = process.env.SCAN_SCHEDULE || '0 */6 * * *';

export function startScheduler() {
  console.log(`Scheduler started with schedule: ${SCAN_SCHEDULE}`);
  console.log(`Auto-download enabled: ${AUTO_DOWNLOAD}`);

  cron.schedule(SCAN_SCHEDULE, async () => {
    console.log('Running scheduled VOD scan...');
    await scanAndProcessVods();
  });

  setTimeout(async () => {
    console.log('Running initial VOD scan...');
    await scanAndProcessVods();
  }, 5000);
}

export async function scanAndProcessVods(options = {}) {
  const db = getDatabase();
  const { clearHistory = false } = options;

  try {
    broadcastStatus({ type: 'scan_start' });

    if (clearHistory) {
      console.log('Clearing previous VOD history...');
      db.prepare('DELETE FROM vods').run();
      db.prepare('DELETE FROM playlist').run();
      db.prepare(
        'UPDATE stream_state SET current_vod_id = NULL WHERE id = 1'
      ).run();
      broadcastStatus({ type: 'history_cleared' });
    }

    const channelId =
      process.env.TWITCH_CHANNEL_ID ||
      (await getChannelId(process.env.TWITCH_RERUN_CHANNEL));

    console.log(`Scanning VODs for channel ID: ${channelId}`);

    const vods = await getRecentVods(channelId, 30);
    console.log(`Found ${vods.length} VODs from last 30 days`);

    let newVodsCount = 0;

    for (const vod of vods) {
      const existing = db
        .prepare('SELECT id FROM vods WHERE id = ?')
        .get(vod.id);

      if (!existing) {
        const mutedSegments = await getMutedSegments(vod.id);

        db.prepare(
          `
          INSERT INTO vods (id, title, url, duration, created_at, muted_segments, download_status)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `
        ).run(
          vod.id,
          vod.title,
          vod.url,
          vod.duration,
          vod.created_at,
          JSON.stringify(mutedSegments),
          AUTO_DOWNLOAD ? 'queued' : 'pending'
        );

        console.log(`Added new VOD: ${vod.title} (${vod.id})`);
        newVodsCount++;
      }
    }

    db.prepare('UPDATE stream_state SET last_scan_at = ? WHERE id = 1').run(
      new Date().toISOString()
    );

    broadcastStatus({
      type: 'scan_complete',
      totalVods: vods.length,
      newVods: newVodsCount,
    });

    console.log(`Scan complete: ${newVodsCount} new VODs added`);

    if (AUTO_DOWNLOAD && newVodsCount > 0) {
      console.log('Auto-starting download queue for new VODs...');
      downloadQueue.processQueue();
    }
  } catch (error) {
    console.error('Error during VOD scan:', error);
    broadcastStatus({ type: 'scan_error', error: error.message });
  }
}
