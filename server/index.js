import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import { WebSocketServer } from 'ws';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { initDatabase } from './database.js';
import { startScheduler } from './scheduler.js';
import { downloadQueue } from './download-queue.js';
import { streamManager } from './stream-manager.js';
import { cleanupPlaylist } from './playlist-manager.js';
import vodRoutes from './routes/vod.js';
import streamRoutes from './routes/stream.js';
import statusRoutes from './routes/status.js';

config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

initDatabase();

downloadQueue.resetStuckDownloads();
streamManager.resetStuckState();
cleanupPlaylist();

app.use('/api/vods', vodRoutes);
app.use('/api/stream', streamRoutes);
app.use('/api/status', statusRoutes);

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(join(__dirname, '../dist')));
  app.get('*', (req, res) => {
    res.sendFile(join(__dirname, '../dist/index.html'));
  });
}

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  startScheduler();
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  console.log('Client connected');
  ws.on('close', () => console.log('Client disconnected'));
});

export { wss };
