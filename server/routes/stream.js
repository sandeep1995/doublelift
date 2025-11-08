import express from 'express';
import { startStream, stopStream, getStreamStatus } from '../streamer.js';
import { getPlaylist } from '../playlist-manager.js';

const router = express.Router();

router.get('/status', (req, res) => {
  const status = getStreamStatus();
  res.json(status);
});

router.get('/playlist', (req, res) => {
  const playlist = getPlaylist();
  res.json(playlist);
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
