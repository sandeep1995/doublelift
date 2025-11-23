import express from 'express';
import { getDatabase } from '../database.js';
import { processVod } from '../vod-processor.js';
import { downloadQueue } from '../download-queue.js';
import { broadcastStatus } from '../websocket.js';

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
    const errorResponse = { success: false, error: error.message };
    broadcastStatus({
      type: 'api_error',
      endpoint: 'POST /api/vods/:id/download',
      error: error.message,
      vodId: req.params.id,
    });
    res.status(500).json(errorResponse);
  }
});

router.post('/:id/retry', async (req, res) => {
  try {
    const result = await downloadQueue.retryFailed(req.params.id);
    res.json(result);
  } catch (error) {
    const errorResponse = { success: false, error: error.message };
    broadcastStatus({
      type: 'api_error',
      endpoint: 'POST /api/vods/:id/retry',
      error: error.message,
      vodId: req.params.id,
    });
    res.status(500).json(errorResponse);
  }
});

router.post('/:id/pause', async (req, res) => {
  try {
    const result = await downloadQueue.pauseDownload(req.params.id);
    res.json(result);
  } catch (error) {
    const errorResponse = { success: false, error: error.message };
    broadcastStatus({
      type: 'api_error',
      endpoint: 'POST /api/vods/:id/pause',
      error: error.message,
      vodId: req.params.id,
    });
    res.status(500).json(errorResponse);
  }
});

router.post('/:id/resume', async (req, res) => {
  try {
    const result = await downloadQueue.resumeDownload(req.params.id);
    res.json(result);
  } catch (error) {
    const errorResponse = { success: false, error: error.message };
    broadcastStatus({
      type: 'api_error',
      endpoint: 'POST /api/vods/:id/resume',
      error: error.message,
      vodId: req.params.id,
    });
    res.status(500).json(errorResponse);
  }
});

router.post('/:id/stop', async (req, res) => {
  try {
    const result = await downloadQueue.stopDownload(req.params.id);
    res.json(result);
  } catch (error) {
    const errorResponse = { success: false, error: error.message };
    broadcastStatus({
      type: 'api_error',
      endpoint: 'POST /api/vods/:id/stop',
      error: error.message,
      vodId: req.params.id,
    });
    res.status(500).json(errorResponse);
  }
});

router.post('/:id/cancel', async (req, res) => {
  try {
    const result = await downloadQueue.cancelDownload(req.params.id);
    res.json(result);
  } catch (error) {
    const errorResponse = { success: false, error: error.message };
    broadcastStatus({
      type: 'api_error',
      endpoint: 'POST /api/vods/:id/cancel',
      error: error.message,
      vodId: req.params.id,
    });
    res.status(500).json(errorResponse);
  }
});

router.post('/:id/process', async (req, res) => {
  try {
    const filePath = await processVod(req.params.id);
    res.json({ success: true, filePath });
  } catch (error) {
    const errorResponse = { success: false, error: error.message };
    broadcastStatus({
      type: 'api_error',
      endpoint: 'POST /api/vods/:id/process',
      error: error.message,
      vodId: req.params.id,
    });
    res.status(500).json(errorResponse);
  }
});

router.post('/:id/reprocess', async (req, res) => {
  try {
    const db = getDatabase();
    const vod = db
      .prepare('SELECT * FROM vods WHERE id = ?')
      .get(req.params.id);

    if (!vod || !vod.downloaded) {
      const errorResponse = { success: false, error: 'VOD not downloaded yet' };
      broadcastStatus({
        type: 'api_error',
        endpoint: 'POST /api/vods/:id/reprocess',
        error: 'VOD not downloaded yet',
        vodId: req.params.id,
      });
      return res.status(400).json(errorResponse);
    }

    // Clear processed status to allow reprocessing
    db.prepare(
      'UPDATE vods SET processed = 0, process_status = ?, processed_file_path = NULL WHERE id = ?'
    ).run('pending', req.params.id);

    const filePath = await processVod(req.params.id);
    res.json({ success: true, filePath });
  } catch (error) {
    const errorResponse = { success: false, error: error.message };
    broadcastStatus({
      type: 'api_error',
      endpoint: 'POST /api/vods/:id/reprocess',
      error: error.message,
      vodId: req.params.id,
    });
    res.status(500).json(errorResponse);
  }
});

router.post('/queue/restart', async (req, res) => {
  try {
    const result = await downloadQueue.restartQueue();
    res.json(result);
  } catch (error) {
    const errorResponse = { success: false, error: error.message };
    broadcastStatus({
      type: 'api_error',
      endpoint: 'POST /api/vods/queue/restart',
      error: error.message,
    });
    res.status(500).json(errorResponse);
  }
});

router.post('/:id/clear-error', async (req, res) => {
  try {
    const db = getDatabase();
    const vod = db.prepare('SELECT * FROM vods WHERE id = ?').get(req.params.id);
    
    if (!vod) {
      return res.status(404).json({ success: false, error: 'VOD not found' });
    }

    db.prepare('UPDATE vods SET error_message = NULL WHERE id = ?').run(req.params.id);
    
    res.json({ success: true, message: 'Error message cleared' });
  } catch (error) {
    const errorResponse = { success: false, error: error.message };
    broadcastStatus({
      type: 'api_error',
      endpoint: 'POST /api/vods/:id/clear-error',
      error: error.message,
      vodId: req.params.id,
    });
    res.status(500).json(errorResponse);
  }
});

export default router;
