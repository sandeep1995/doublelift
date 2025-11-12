import { useState, useEffect } from 'react';
import Dashboard from './components/Dashboard';
import StreamControls from './components/StreamControls';
import VodList from './components/VodList';
import Playlist from './components/Playlist';
import ActivityLog from './components/ActivityLog';
import './App.css';

function App() {
  const [status, setStatus] = useState(null);
  const [logs, setLogs] = useState([]);
  const [ws, setWs] = useState(null);

  useEffect(() => {
    fetchStatus();
    connectWebSocket();

    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  const fetchStatus = async () => {
    try {
      const response = await fetch('/api/status');
      const data = await response.json();
      setStatus(data);
    } catch (error) {
      console.error('Failed to fetch status:', error);
    }
  };

  const connectWebSocket = () => {
    const websocket = new WebSocket(`ws://${window.location.hostname}:3000`);

    websocket.onopen = () => {
      console.log('WebSocket connected');
      addLog('Connected to server');
    };

    websocket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      addLog(formatLogMessage(data));

      if (
        ['stream_start', 'stream_stop', 'scan_complete'].includes(data.type)
      ) {
        fetchStatus();
      }
    };

    websocket.onclose = () => {
      console.log('WebSocket disconnected');
      addLog('Disconnected from server');
      setTimeout(connectWebSocket, 5000);
    };

    setWs(websocket);
  };

  const addLog = (message) => {
    setLogs((prev) =>
      [{ timestamp: new Date().toISOString(), message }, ...prev].slice(0, 100)
    );
  };

  const formatLogMessage = (data) => {
    switch (data.type) {
      case 'scan_start':
        return 'Starting VOD scan...';
      case 'scan_complete':
        return `Scan complete: ${data.newVods} new VODs found`;
      case 'download_start':
        return `Downloading: ${data.title}`;
      case 'download_complete':
        return `Download complete: ${data.vodId}`;
      case 'process_start':
        return `Processing: ${data.title}`;
      case 'process_complete':
        return `Processing complete: ${data.vodId}`;
      case 'stream_start':
        return 'Stream started';
      case 'stream_stop':
        return 'Stream stopped';
      case 'stream_vod_change':
        return `Now streaming: ${data.title} (${data.position}/${data.total})`;
      case 'playlist_updated':
        return `Playlist updated: ${data.vodCount} VODs, ${data.totalHours}h total`;
      default:
        return JSON.stringify(data);
    }
  };

  return (
    <div className='app'>
      <header className='header'>
        <div className='header-content'>
          <h1>DoubleLift VOD Streamer</h1>
          <div className='header-subtitle'>
            Automated Twitch Rerun Channel Manager
          </div>
        </div>
      </header>

      <div className='container'>
        <Dashboard status={status} />
        <StreamControls status={status} onUpdate={fetchStatus} />

        <div className='two-column'>
          <VodList />
          <Playlist />
        </div>

        <ActivityLog logs={logs} />
      </div>
    </div>
  );
}

export default App;
