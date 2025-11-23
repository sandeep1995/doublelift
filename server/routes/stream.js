import express from 'express';
import { startStream, stopStream, getStreamStatus } from '../streamer.js';
import {
  getPlaylist,
  updatePlaylist,
  addVodToPlaylist,
  removeVodFromPlaylist,
  isVodInPlaylist,
} from '../playlist-manager.js';

const router = express.Router();

router.get('/status', (req, res) => {
  const status = getStreamStatus();
  res.json(status);
});

router.get('/playlist', (req, res) => {
  const playlist = getPlaylist();
  res.json(playlist);
});

router.post('/playlist/update', async (req, res) => {
  try {
    await updatePlaylist();
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
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/playlist/:vodId/remove', async (req, res) => {
  try {
    const result = removeVodFromPlaylist(req.params.vodId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
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

router.post('/start', async (req, res) => {
  const result = await startStream();
  res.json(result);
});

router.post('/stop', async (req, res) => {
  const result = await stopStream();
  res.json(result);
});

export default router;
