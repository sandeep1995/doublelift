import express from 'express';
import {
  streamManager,
  startStream,
  stopStream,
  getStreamStatus,
} from '../stream-manager.js';
import {
  getPlaylist,
  updatePlaylist,
  addVodToPlaylist,
  removeVodFromPlaylist,
  isVodInPlaylist,
} from '../playlist-manager.js';
import { broadcastStatus } from '../websocket.js';

const router = express.Router();

// Stream status
router.get('/status', (req, res) => {
  try {
    const status = getStreamStatus();
    res.json(status);
  } catch (error) {
    const errorResponse = { success: false, error: error.message };
    broadcastStatus({
      type: 'api_error',
      endpoint: 'GET /api/stream/status',
      error: error.message,
    });
    res.status(500).json(errorResponse);
  }
});

// Stream control
router.post('/start', async (req, res) => {
  try {
    const { resume, startFromIndex, startFromVodId } = req.body;
    const result = await startStream({
      resume,
      startFromIndex,
      startFromVodId,
    });
    res.json(result);
  } catch (error) {
    const errorResponse = { success: false, error: error.message };
    broadcastStatus({
      type: 'api_error',
      endpoint: 'POST /api/stream/start',
      error: error.message,
    });
    res.status(500).json(errorResponse);
  }
});

router.post('/stop', async (req, res) => {
  try {
    const result = await stopStream();
    res.json(result);
  } catch (error) {
    const errorResponse = { success: false, error: error.message };
    broadcastStatus({
      type: 'api_error',
      endpoint: 'POST /api/stream/stop',
      error: error.message,
    });
    res.status(500).json(errorResponse);
  }
});

router.post('/skip-next', async (req, res) => {
  try {
    const result = await streamManager.skipToNext();
    res.json(result);
  } catch (error) {
    const errorResponse = { success: false, error: error.message };
    broadcastStatus({
      type: 'api_error',
      endpoint: 'POST /api/stream/skip-next',
      error: error.message,
    });
    res.status(500).json(errorResponse);
  }
});

router.post('/skip-to/:vodId', async (req, res) => {
  try {
    const result = await streamManager.skipToVod(req.params.vodId);
    res.json(result);
  } catch (error) {
    const errorResponse = { success: false, error: error.message };
    broadcastStatus({
      type: 'api_error',
      endpoint: 'POST /api/stream/skip-to/:vodId',
      error: error.message,
      vodId: req.params.vodId,
    });
    res.status(500).json(errorResponse);
  }
});

router.post('/reload-playlist', async (req, res) => {
  try {
    const result = await streamManager.reloadPlaylist();
    res.json(result);
  } catch (error) {
    const errorResponse = { success: false, error: error.message };
    broadcastStatus({
      type: 'api_error',
      endpoint: 'POST /api/stream/reload-playlist',
      error: error.message,
    });
    res.status(500).json(errorResponse);
  }
});

// Playlist management
router.get('/playlist', (req, res) => {
  try {
    const playlist = getPlaylist();
    res.json(playlist);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/playlist/update', async (req, res) => {
  try {
    await updatePlaylist();
    // Reload playlist in stream manager if streaming
    if (streamManager.isStreaming) {
      await streamManager.reloadPlaylist();
    }
    res.json({
      success: true,
      message: 'Playlist updated with all processed VODs',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/playlist/:vodId/add', async (req, res) => {
  try {
    const result = await addVodToPlaylist(req.params.vodId);
    // Reload playlist in stream manager if streaming
    if (streamManager.isStreaming) {
      await streamManager.reloadPlaylist();
    }
    res.json(result);
  } catch (error) {
    const errorResponse = { success: false, error: error.message };
    broadcastStatus({
      type: 'api_error',
      endpoint: 'POST /api/stream/playlist/:vodId/add',
      error: error.message,
      vodId: req.params.vodId,
    });
    res.status(500).json(errorResponse);
  }
});

router.post('/playlist/:vodId/remove', async (req, res) => {
  try {
    const result = removeVodFromPlaylist(req.params.vodId);
    // Reload playlist in stream manager if streaming
    if (streamManager.isStreaming) {
      await streamManager.reloadPlaylist();
    }
    res.json(result);
  } catch (error) {
    const errorResponse = { success: false, error: error.message };
    broadcastStatus({
      type: 'api_error',
      endpoint: 'POST /api/stream/playlist/:vodId/remove',
      error: error.message,
      vodId: req.params.vodId,
    });
    res.status(500).json(errorResponse);
  }
});

router.get('/playlist/:vodId/check', (req, res) => {
  try {
    const inPlaylist = isVodInPlaylist(req.params.vodId);
    res.json({ inPlaylist });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
