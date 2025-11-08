import express from 'express';
import { getDatabase } from '../database.js';
import { downloadVod, processVod } from '../vod-processor.js';

const router = express.Router();

router.get('/', (req, res) => {
  const db = getDatabase();
  const vods = db.prepare('SELECT * FROM vods ORDER BY created_at DESC').all();
  res.json(vods);
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
    const filePath = await downloadVod(req.params.id);
    res.json({ success: true, filePath });
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

export default router;
