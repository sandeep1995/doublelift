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
