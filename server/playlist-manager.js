import { getDatabase } from './database.js';
import { broadcastStatus } from './websocket.js';

function parseDuration(duration) {
  const match = duration.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
  const hours = parseInt(match[1] || 0);
  const minutes = parseInt(match[2] || 0);
  const seconds = parseInt(match[3] || 0);
  return hours * 3600 + minutes * 60 + seconds;
}

export async function updatePlaylist() {
  const db = getDatabase();

  const TARGET_DURATION = 48 * 3600;

  const processedVods = db
    .prepare(
      `
    SELECT * FROM vods 
    WHERE processed = 1 
    ORDER BY created_at DESC
  `
    )
    .all();

  if (processedVods.length === 0) {
    console.log('No processed VODs available for playlist');
    return;
  }

  db.prepare('DELETE FROM playlist').run();

  let totalDuration = 0;
  let position = 0;

  for (const vod of processedVods) {
    const vodDuration = parseDuration(vod.duration);

    if (totalDuration + vodDuration <= TARGET_DURATION) {
      db.prepare(
        `
        INSERT INTO playlist (vod_id, position, added_at)
        VALUES (?, ?, ?)
      `
      ).run(vod.id, position, new Date().toISOString());

      totalDuration += vodDuration;
      position++;

      console.log(`Added to playlist: ${vod.title} (${vod.duration})`);

      if (totalDuration >= TARGET_DURATION) {
        break;
      }
    }
  }

  // Check if last VOD is still in new playlist, if not clear last position
  const state = db.prepare('SELECT * FROM stream_state WHERE id = 1').get();
  if (state && state.last_vod_id) {
    const lastVodStillExists = processedVods.some(
      (v) => v.id === state.last_vod_id
    );
    if (!lastVodStillExists) {
      db.prepare(
        'UPDATE stream_state SET last_vod_id = NULL, last_vod_index = NULL WHERE id = 1'
      ).run();
    }
  }

  db.prepare(
    'UPDATE stream_state SET playlist_updated_at = ? WHERE id = 1'
  ).run(new Date().toISOString());

  console.log(
    `Playlist updated: ${position} VODs, total duration: ${Math.round(
      totalDuration / 3600
    )}h`
  );

  broadcastStatus({
    type: 'playlist_updated',
    vodCount: position,
    totalHours: Math.round(totalDuration / 3600),
  });
}

export function getPlaylist() {
  const db = getDatabase();

  const playlist = db
    .prepare(
      `
    SELECT p.*, v.title, v.duration, v.processed_file_path
    FROM playlist p
    JOIN vods v ON p.vod_id = v.id
    ORDER BY p.position
  `
    )
    .all();

  return playlist;
}

export function isVodInPlaylist(vodId) {
  const db = getDatabase();
  const result = db
    .prepare('SELECT COUNT(*) as count FROM playlist WHERE vod_id = ?')
    .get(vodId);
  return result.count > 0;
}

export async function addVodToPlaylist(vodId) {
  const db = getDatabase();
  const vod = db.prepare('SELECT * FROM vods WHERE id = ?').get(vodId);

  if (!vod) {
    throw new Error(`VOD ${vodId} not found`);
  }

  if (!vod.processed) {
    throw new Error(`VOD ${vodId} is not processed yet`);
  }

  if (isVodInPlaylist(vodId)) {
    return { success: true, message: 'VOD already in playlist' };
  }

  // Get the current max position
  const maxPosition = db
    .prepare('SELECT MAX(position) as max FROM playlist')
    .get();

  const nextPosition = (maxPosition?.max ?? -1) + 1;

  // Check total duration
  const TARGET_DURATION = 48 * 3600;
  const currentPlaylist = getPlaylist();
  let totalDuration = 0;

  for (const item of currentPlaylist) {
    totalDuration += parseDuration(item.duration);
  }

  const vodDuration = parseDuration(vod.duration);

  if (totalDuration + vodDuration > TARGET_DURATION) {
    throw new Error(
      `Adding this VOD would exceed 48-hour limit. Current: ${Math.round(
        totalDuration / 3600
      )}h, Adding: ${Math.round(vodDuration / 3600)}h`
    );
  }

  db.prepare(
    `
    INSERT INTO playlist (vod_id, position, added_at)
    VALUES (?, ?, ?)
  `
  ).run(vodId, nextPosition, new Date().toISOString());

  db.prepare(
    'UPDATE stream_state SET playlist_updated_at = ? WHERE id = 1'
  ).run(new Date().toISOString());

  broadcastStatus({
    type: 'playlist_updated',
    vodCount: currentPlaylist.length + 1,
    totalHours: Math.round((totalDuration + vodDuration) / 3600),
  });

  return { success: true, message: 'VOD added to playlist' };
}

export function removeVodFromPlaylist(vodId) {
  const db = getDatabase();

  if (!isVodInPlaylist(vodId)) {
    return { success: true, message: 'VOD not in playlist' };
  }

  const removed = db
    .prepare('DELETE FROM playlist WHERE vod_id = ?')
    .run(vodId);

  // Reorder positions
  const remaining = db
    .prepare('SELECT * FROM playlist ORDER BY position')
    .all();

  remaining.forEach((item, index) => {
    db.prepare('UPDATE playlist SET position = ? WHERE vod_id = ?').run(
      index,
      item.vod_id
    );
  });

  db.prepare(
    'UPDATE stream_state SET playlist_updated_at = ? WHERE id = 1'
  ).run(new Date().toISOString());

  broadcastStatus({
    type: 'playlist_updated',
    vodCount: remaining.length,
  });

  return { success: true, message: 'VOD removed from playlist' };
}
