import { useState, useEffect } from 'react';
import { useServerEvents } from '../state/useServerEvents';
import './StreamControls.css';

function StreamControls({ status, onUpdate }) {
  const { refreshStatus } = useServerEvents();
  const [loading, setLoading] = useState(false);
  const [streamInfo, setStreamInfo] = useState(status);
  const [showStartDialog, setShowStartDialog] = useState(false);

  useEffect(() => {
    setStreamInfo(status);
  }, [status]);

  useEffect(() => {
    if (!status?.isStreaming) return;

    const interval = setInterval(() => {
      setStreamInfo((prev) => {
        if (!prev?.isStreaming) return prev;
        return {
          ...prev,
          streamElapsed: prev.streamElapsed ? prev.streamElapsed + 1 : 0,
          vodElapsed: prev.vodElapsed ? prev.vodElapsed + 1 : 0,
        };
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [status?.isStreaming]);

  const formatTime = (seconds) => {
    if (!seconds) return '0:00';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs
        .toString()
        .padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  const handleStartStream = async (options = {}) => {
    setLoading(true);
    setShowStartDialog(false);
    try {
      const response = await fetch('/api/stream/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options),
      });
      const data = await response.json();
      if (data.success) {
        onUpdate();
      } else {
        throw new Error(data.error || data.message || 'Failed to start stream');
      }
    } catch (error) {
      console.error('Failed to start stream:', error);
      // Error will be shown via notifications from websocket
    } finally {
      setLoading(false);
    }
  };

  const handleStartClick = () => {
    if (status?.lastVodId && status?.lastVodTitle) {
      setShowStartDialog(true);
    } else {
      handleStartStream();
    }
  };

  const handleStopStream = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/stream/stop', { method: 'POST' });
      const data = await response.json();
      if (data.success) {
        onUpdate();
      } else {
        throw new Error(data.error || data.message || 'Failed to stop stream');
      }
    } catch (error) {
      console.error('Failed to stop stream:', error);
      // Error will be shown via notifications from websocket
    } finally {
      setLoading(false);
    }
  };

  const handleSkipNext = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/stream/skip-next', {
        method: 'POST',
      });
      const data = await response.json();
      if (data.success) {
        onUpdate();
      } else {
        throw new Error(data.error || data.message || 'Failed to skip to next');
      }
    } catch (error) {
      console.error('Failed to skip to next:', error);
      // Error will be shown via notifications from websocket
    } finally {
      setLoading(false);
    }
  };

  const handleReloadPlaylist = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/stream/reload-playlist', {
        method: 'POST',
      });
      const data = await response.json();
      if (data.success) {
        onUpdate();
      } else {
        throw new Error(data.error || data.message || 'Failed to reload playlist');
      }
    } catch (error) {
      console.error('Failed to reload playlist:', error);
      // Error will be shown via notifications from websocket
    } finally {
      setLoading(false);
    }
  };

  const handleManualScan = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/status/scan', { method: 'POST' });
      const data = await response.json();
      if (data.success) {
        onUpdate();
      } else {
        throw new Error(data.error || data.message || 'Failed to start scan');
      }
    } catch (error) {
      console.error('Failed to start scan:', error);
      // Error will be shown via notifications from websocket
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className='card stream-controls'>
      <h2>Stream Controls</h2>

      {showStartDialog && (
        <div
          className='start-dialog-overlay'
          onClick={() => setShowStartDialog(false)}
        >
          <div className='start-dialog' onClick={(e) => e.stopPropagation()}>
            <h3>Start Stream</h3>
            <p className='dialog-description'>
              Choose where to start the stream:
            </p>
            <div className='start-options'>
              <button
                className='button button-secondary'
                onClick={() => handleStartStream({ resume: false })}
                disabled={loading}
              >
                Start from Beginning
              </button>
              {status?.lastVodId && status?.lastVodTitle && (
                <button
                  className='button'
                  onClick={() => handleStartStream({ resume: true })}
                  disabled={loading}
                >
                  Resume from Last Position
                  <span className='option-detail'>
                    ({status.lastVodTitle.substring(0, 50)}
                    {status.lastVodTitle.length > 50 ? '...' : ''})
                  </span>
                </button>
              )}
            </div>
            <button
              className='button button-secondary'
              onClick={() => setShowStartDialog(false)}
              disabled={loading}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className='control-buttons'>
        <button
          className='button'
          onClick={handleStartClick}
          disabled={loading || status?.isStreaming}
        >
          Start Stream
        </button>

        <button
          className='button button-danger'
          onClick={handleStopStream}
          disabled={loading || !status?.isStreaming}
        >
          Stop Stream
        </button>

        {status?.isStreaming && (
          <button
            className='button button-warning'
            onClick={handleSkipNext}
            disabled={loading}
            title='Skip to next VOD in playlist'
          >
            Skip Next
          </button>
        )}

        {status?.isStreaming && (
          <button
            className='button button-info'
            onClick={handleReloadPlaylist}
            disabled={loading}
            title='Reload playlist without stopping stream'
          >
            Reload Playlist
          </button>
        )}

        <button
          className='button button-secondary'
          onClick={handleManualScan}
          disabled={loading}
        >
          Manual Scan
        </button>
      </div>

      {streamInfo?.isStreaming && (
        <div className='stream-info-panel'>
          <div className='stream-info-header'>
            <span className='stream-status-indicator'>● LIVE</span>
            <span className='stream-elapsed'>
              Stream Time: {formatTime(streamInfo.streamElapsed)}
            </span>
          </div>

          {streamInfo.currentVodTitle && (
            <div className='stream-info-content'>
              <div className='stream-info-row'>
                <span className='stream-info-label'>Current VOD:</span>
                <span className='stream-info-value'>
                  {streamInfo.currentVodTitle}
                </span>
              </div>

              {streamInfo.currentVodPosition && streamInfo.currentVodTotal && (
                <div className='stream-info-row'>
                  <span className='stream-info-label'>Position:</span>
                  <span className='stream-info-value'>
                    {streamInfo.currentVodPosition} /{' '}
                    {streamInfo.currentVodTotal}
                  </span>
                </div>
              )}

              <div className='stream-info-row'>
                <span className='stream-info-label'>VOD Elapsed:</span>
                <span className='stream-info-value'>
                  {formatTime(streamInfo.vodElapsed)}
                  {streamInfo.currentVodDuration &&
                    ` / ${streamInfo.currentVodDuration}`}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {!status?.isStreaming && status?.lastVodId && status?.lastVodTitle && (
        <div className='last-stream-info'>
          <div className='last-stream-header'>
            <span className='last-stream-label'>Last Stream Position:</span>
          </div>
          <div className='last-stream-content'>
            <span className='last-stream-title'>{status.lastVodTitle}</span>
            {status.lastVodIndex !== null && (
              <span className='last-stream-position'>
                Position: {status.lastVodIndex + 1}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default StreamControls;
