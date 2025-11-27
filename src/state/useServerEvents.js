import { useState, useEffect, useCallback, useRef } from 'react';

const WS_RECONNECT_DELAY = 5000;

export function useServerEvents() {
  const [status, setStatus] = useState(null);
  const [queueStatus, setQueueStatus] = useState(null);
  const [playlist, setPlaylist] = useState([]);
  const [playlistVodIds, setPlaylistVodIds] = useState(new Set());
  const [vods, setVods] = useState([]);
  const [downloadProgress, setDownloadProgress] = useState({});
  const [processProgress, setProcessProgress] = useState({});
  const [logs, setLogs] = useState([]);
  const [errors, setErrors] = useState([]);
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const isConnectingRef = useRef(false);
  const connectionAttemptsRef = useRef(0);
  const hasConnectedOnceRef = useRef(false);

  const addLog = useCallback((message) => {
    setLogs((prev) =>
      [{ timestamp: new Date().toISOString(), message }, ...prev].slice(0, 100)
    );
  }, []);

  const addError = useCallback((error) => {
    setErrors((prev) => [
      {
        id: Date.now(),
        timestamp: new Date().toISOString(),
        message: error.message || error.error || 'Unknown error',
        type: error.type || 'error',
        ...error,
      },
      ...prev,
    ].slice(0, 50));
  }, []);

  const formatLogMessage = useCallback((data) => {
    switch (data.type) {
      case 'scan_start':
        return 'Starting VOD scan...';
      case 'scan_complete':
        return `Scan complete: ${data.newVods} new VODs found`;
      case 'download_start':
        return `Downloading: ${data.title || data.vodId}`;
      case 'download_progress':
        const parts = [];
        if (data.vodsCount !== null && data.totalVods !== null) {
          parts.push(`Downloaded ${data.vodsCount}/${data.totalVods} VODs`);
        }
        if (data.percent !== null) {
          parts.push(`${data.percent}%`);
        }
        if (data.totalSize) {
          parts.push(`of ${data.totalSize}`);
        }
        if (data.speed) {
          parts.push(`at ${data.speed}`);
        }
        if (data.eta) {
          parts.push(`ETA ${data.eta}`);
        }
        return parts.length > 0
          ? parts.join(' ')
          : data.logLine || `Downloading ${data.percent || 0}%`;
      case 'download_complete':
        return `Download complete: ${data.vodId}`;
      case 'process_start':
        return `Processing: ${data.title || data.vodId}`;
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
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/status');
      const data = await response.json();
      setStatus(data);
    } catch (error) {
      console.error('Failed to fetch status:', error);
      addError({ error: error.message, type: 'fetch_error', endpoint: '/api/status' });
    }
  }, [addError]);

  const fetchVods = useCallback(async () => {
    try {
      const response = await fetch('/api/vods');
      const data = await response.json();
      setVods(data);
    } catch (error) {
      console.error('Failed to fetch VODs:', error);
      addError({ error: error.message, type: 'fetch_error', endpoint: '/api/vods' });
    }
  }, [addError]);

  const fetchPlaylist = useCallback(async () => {
    try {
      const response = await fetch('/api/stream/playlist');
      const data = await response.json();
      setPlaylist(data);
      const ids = new Set(data.map((item) => item.vod_id));
      setPlaylistVodIds(ids);
    } catch (error) {
      console.error('Failed to fetch playlist:', error);
      addError({ error: error.message, type: 'fetch_error', endpoint: '/api/stream/playlist' });
    }
  }, [addError]);

  const fetchQueueStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/vods/queue/status');
      const data = await response.json();
      setQueueStatus(data);
    } catch (error) {
      console.error('Failed to fetch queue status:', error);
      addError({ error: error.message, type: 'fetch_error', endpoint: '/api/vods/queue/status' });
    }
  }, [addError]);

  const connectWebSocket = useCallback(() => {
    if (isConnectingRef.current || (wsRef.current && wsRef.current.readyState === WebSocket.OPEN)) {
      return;
    }

    isConnectingRef.current = true;
    const ws = new WebSocket(`ws://${window.location.hostname}:3000`);

    ws.onopen = () => {
      console.log('WebSocket connected');
      isConnectingRef.current = false;
      connectionAttemptsRef.current = 0;
      hasConnectedOnceRef.current = true;
      addLog('Connected to server');
      // Fetch initial data after connection
      fetchStatus();
      fetchVods();
      fetchPlaylist();
      fetchQueueStatus();
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // Handle error events
        if (data.type === 'api_error' || data.type === 'download_error' || data.type === 'process_error' || data.type === 'stream_error') {
          addError(data);
        }

        // Handle log events
        if (data.type && !data.type.includes('error')) {
          addLog(formatLogMessage(data));
        }

        // Handle status updates
        if (data.type === 'stream_status_update') {
          setStatus((prev) => ({ ...prev, ...data }));
        }

        // Handle queue status updates
        if (data.type === 'queue_status_update') {
          setQueueStatus(data);
        }

        // Handle playlist updates
        if (data.type === 'playlist_updated') {
          fetchPlaylist();
        }

        // Handle download progress
        if (data.type === 'download_progress' && data.vodId) {
          setDownloadProgress((prev) => ({
            ...prev,
            [data.vodId]: {
              percent: data.percent,
              vodsCount: data.vodsCount,
              totalVods: data.totalVods,
              totalSize: data.totalSize,
              speed: data.speed,
              eta: data.eta,
              logLine: data.logLine,
            },
          }));
        }

        // Handle process progress
        if (data.type === 'process_start' && data.vodId) {
          setProcessProgress((prev) => ({
            ...prev,
            [data.vodId]: {
              message: 'Starting processing...',
              stage: 'starting',
            },
          }));
        }

        if (data.type === 'process_progress' && data.vodId) {
          setProcessProgress((prev) => ({
            ...prev,
            [data.vodId]: {
              message: data.message,
              stage: data.stage,
              percent: data.percent,
              segmentsFound: data.segmentsFound,
              latestSegment: data.latestSegment,
              segment: data.segment,
              total: data.total,
            },
          }));
        }

        if (data.type === 'process_complete' && data.vodId) {
          setProcessProgress((prev) => {
            const newState = { ...prev };
            delete newState[data.vodId];
            return newState;
          });
          fetchVods();
        }

        if (data.type === 'process_error' && data.vodId) {
          setProcessProgress((prev) => {
            const newState = { ...prev };
            delete newState[data.vodId];
            return newState;
          });
          fetchVods();
        }

        // Refresh data on significant events
        if (
          [
            'stream_start',
            'stream_stop',
            'stream_vod_change',
            'scan_complete',
            'download_complete',
          ].includes(data.type)
        ) {
          fetchStatus();
          fetchVods();
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      isConnectingRef.current = false;
      
      // Only log disconnection if we were previously connected
      if (hasConnectedOnceRef.current) {
        addLog('Disconnected from server');
      }
      
      wsRef.current = null;

      // Attempt to reconnect
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      reconnectTimeoutRef.current = setTimeout(() => {
        connectWebSocket();
      }, WS_RECONNECT_DELAY);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      isConnectingRef.current = false;
      connectionAttemptsRef.current += 1;
      
      // Only show error if we've connected before (indicating a real disconnection)
      // or if we've failed multiple initial connection attempts (server might be down)
      if (hasConnectedOnceRef.current || connectionAttemptsRef.current > 3) {
        addError({ 
          error: hasConnectedOnceRef.current 
            ? 'WebSocket connection lost' 
            : 'Unable to connect to server. Please check if the server is running.',
          type: 'websocket_error' 
        });
      }
    };

    wsRef.current = ws;
  }, [addLog, addError, formatLogMessage, fetchStatus, fetchVods, fetchPlaylist, fetchQueueStatus]);

  useEffect(() => {
    connectWebSocket();

    // Periodic refresh (less frequent since we have WebSocket updates)
    const statusInterval = setInterval(fetchStatus, 30000);
    const vodsInterval = setInterval(fetchVods, 10000);
    const playlistInterval = setInterval(fetchPlaylist, 10000);
    const queueInterval = setInterval(fetchQueueStatus, 5000);

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      clearInterval(statusInterval);
      clearInterval(vodsInterval);
      clearInterval(playlistInterval);
      clearInterval(queueInterval);
    };
  }, [connectWebSocket, fetchStatus, fetchVods, fetchPlaylist, fetchQueueStatus]);

  const dismissError = useCallback((errorId) => {
    setErrors((prev) => prev.filter((err) => err.id !== errorId));
  }, []);

  const clearErrors = useCallback(() => {
    setErrors([]);
  }, []);

  return {
    status,
    queueStatus,
    playlist,
    playlistVodIds,
    vods,
    downloadProgress,
    processProgress,
    logs,
    errors,
    dismissError,
    clearErrors,
    refreshStatus: fetchStatus,
    refreshVods: fetchVods,
    refreshPlaylist: fetchPlaylist,
    refreshQueueStatus: fetchQueueStatus,
  };
}

