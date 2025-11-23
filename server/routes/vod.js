import express from 'express';
import { getDatabase } from '../database.js';
import { processVod } from '../vod-processor.js';
import { downloadQueue } from '../download-queue.js';

const router = express.Router();

router.get('/', (req, res) => {
  const db = getDatabase();
  const vods = db.prepare('SELECT * FROM vods ORDER BY created_at DESC').all();
  res.json(vods);
});

router.get('/queue/status', (req, res) => {
  try {
    const status = downloadQueue.getQueueStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', (req, res) => {
  const db = getDatabase();
  const vod = db.prepare('SELECT * FROM vods WHERE id = ?').get(req.params.id);

  if (!vod) {
    return res.status(404).json({ error: 'VOD not found' });
  }

  res.json(vod);
});

router.post('/:id/download', async (req, res) => {
  try {
    const result = await downloadQueue.addToQueue(req.params.id);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/retry', async (req, res) => {
  try {
    const result = await downloadQueue.retryFailed(req.params.id);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/cancel', async (req, res) => {
  try {
    const result = await downloadQueue.cancelDownload(req.params.id);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/process', async (req, res) => {
  try {
    const filePath = await processVod(req.params.id);
    res.json({ success: true, filePath });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/queue/restart', async (req, res) => {
  try {
    const result = await downloadQueue.restartQueue();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
