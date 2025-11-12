import { useState } from 'react';
import './StreamControls.css';

function StreamControls({ status, onUpdate }) {
  const [loading, setLoading] = useState(false);

  const handleStartStream = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/stream/start', { method: 'POST' });
      const data = await response.json();
      if (data.success) {
        onUpdate();
      } else {
        alert(data.message);
      }
    } catch (error) {
      alert('Failed to start stream: ' + error.message);
    } finally {
      setLoading(false);
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
        alert(data.message);
      }
    } catch (error) {
      alert('Failed to stop stream: ' + error.message);
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
        alert('VOD scan started');
        onUpdate();
      }
    } catch (error) {
      alert('Failed to start scan: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className='card stream-controls'>
      <h2>Stream Controls</h2>

      <div className='control-buttons'>
        <button
          className='button'
          onClick={handleStartStream}
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

        <button
          className='button button-secondary'
          onClick={handleManualScan}
          disabled={loading}
        >
          Manual Scan
        </button>
      </div>

      {status?.currentVodId && (
        <div className='current-stream-info'>
          <span className='current-label'>Currently Streaming:</span>
          <span className='current-value'>{status.currentVodId}</span>
        </div>
      )}
    </div>
  );
}

export default StreamControls;
