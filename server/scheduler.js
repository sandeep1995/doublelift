import cron from 'node-cron';
import { getDatabase } from './database.js';
import { getChannelId, getRecentVods, getMutedSegments } from './twitch-api.js';
import { broadcastStatus } from './websocket.js';

export function startScheduler() {
  const schedule = process.env.SCAN_SCHEDULE || '0 0 * * *';

  console.log(`Scheduler started with schedule: ${schedule}`);

  cron.schedule(schedule, async () => {
    console.log('Running scheduled VOD scan...');
    await scanAndProcessVods();
  });

  setTimeout(async () => {
    console.log('Running initial VOD scan...');
    await scanAndProcessVods();
  }, 5000);
}

export async function scanAndProcessVods() {
  const db = getDatabase();

  try {
    broadcastStatus({ type: 'scan_start' });

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
          INSERT INTO vods (id, title, url, duration, created_at, muted_segments)
          VALUES (?, ?, ?, ?, ?, ?)
        `
        ).run(
          vod.id,
          vod.title,
          vod.url,
          vod.duration,
          vod.created_at,
          JSON.stringify(mutedSegments)
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
  } catch (error) {
    console.error('Error during VOD scan:', error);
    broadcastStatus({ type: 'scan_error', error: error.message });
  }
}
