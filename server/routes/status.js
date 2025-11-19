import express from 'express';
import { getDatabase } from '../database.js';
import { scanAndProcessVods } from '../scheduler.js';

const router = express.Router();

router.get('/', (req, res) => {
  const db = getDatabase();
  const state = db.prepare('SELECT * FROM stream_state WHERE id = 1').get();

  const totalVods = db
    .prepare('SELECT COUNT(*) as count FROM vods')
    .get().count;
  const downloadedVods = db
    .prepare('SELECT COUNT(*) as count FROM vods WHERE downloaded = 1')
    .get().count;
  const processedVods = db
    .prepare('SELECT COUNT(*) as count FROM vods WHERE processed = 1')
    .get().count;
  const playlistCount = db
    .prepare('SELECT COUNT(*) as count FROM playlist')
    .get().count;

  res.json({
    isStreaming: Boolean(state.is_streaming),
    currentVodId: state.current_vod_id,
    lastScan: state.last_scan_at,
    playlistUpdated: state.playlist_updated_at,
    stats: {
      totalVods,
      downloadedVods,
      processedVods,
      playlistCount,
    },
  });
});

router.post('/scan', async (req, res) => {
  scanAndProcessVods({ clearHistory: true })
    .then(() => {
      res.json({ success: true, message: 'Scan started with history cleared' });
    })
    .catch((error) => {
      res.status(500).json({ error: error.message });
    });
});

export default router;
