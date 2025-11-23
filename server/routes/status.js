import express from 'express';
import { getDatabase } from '../database.js';
import { scanAndProcessVods } from '../scheduler.js';
import { getStreamStatus } from '../stream-manager.js';

const router = express.Router();

router.get('/', (req, res) => {
  const db = getDatabase();
  const streamStatus = getStreamStatus();

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
    ...streamStatus,
    lastScan: streamStatus.lastScan,
    playlistUpdated: streamStatus.playlistUpdated,
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
