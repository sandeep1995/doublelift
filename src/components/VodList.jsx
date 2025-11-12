import { useState, useEffect } from 'react';
import './VodList.css';

function VodList() {
  const [vods, setVods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionInProgress, setActionInProgress] = useState({});

  useEffect(() => {
    fetchVods();
    const interval = setInterval(fetchVods, 3000);
    return () => clearInterval(interval);
  }, []);

  const fetchVods = async () => {
    try {
      const response = await fetch('/api/vods');
      const data = await response.json();
      setVods(data);
    } catch (error) {
      console.error('Failed to fetch VODs:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (vodId) => {
    setActionInProgress((prev) => ({ ...prev, [vodId]: 'downloading' }));
    try {
      const response = await fetch(`/api/vods/${vodId}/download`, {
        method: 'POST',
      });
      const result = await response.json();
      if (result.success || result.message) {
        await fetchVods();
      }
    } catch (error) {
      console.error('Failed to queue download:', error);
      alert('Failed to queue download: ' + error.message);
    } finally {
      setActionInProgress((prev) => {
        const newState = { ...prev };
        delete newState[vodId];
        return newState;
      });
    }
  };

  const handleRetry = async (vodId) => {
    setActionInProgress((prev) => ({ ...prev, [vodId]: 'retrying' }));
    try {
      const response = await fetch(`/api/vods/${vodId}/retry`, {
        method: 'POST',
      });
      const result = await response.json();
      if (result.success || result.message) {
        await fetchVods();
      }
    } catch (error) {
      console.error('Failed to retry download:', error);
      alert('Failed to retry download: ' + error.message);
    } finally {
      setActionInProgress((prev) => {
        const newState = { ...prev };
        delete newState[vodId];
        return newState;
      });
    }
  };

  const handleProcess = async (vodId) => {
    setActionInProgress((prev) => ({ ...prev, [vodId]: 'processing' }));
    try {
      const response = await fetch(`/api/vods/${vodId}/process`, {
        method: 'POST',
      });
      const result = await response.json();
      if (result.success) {
        await fetchVods();
      }
    } catch (error) {
      console.error('Failed to process VOD:', error);
      alert('Failed to process VOD: ' + error.message);
    } finally {
      setActionInProgress((prev) => {
        const newState = { ...prev };
        delete newState[vodId];
        return newState;
      });
    }
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const getDownloadStatusBadge = (vod) => {
    const status = vod.download_status || 'pending';

    if (vod.downloaded && status === 'completed') {
      return <span className='badge badge-success'>Downloaded</span>;
    }

    switch (status) {
      case 'downloading':
        return (
          <span className='badge badge-info'>
            Downloading {vod.download_progress || 0}%
          </span>
        );
      case 'queued':
        return <span className='badge badge-warning'>Queued</span>;
      case 'failed':
        return <span className='badge badge-error'>Failed</span>;
      case 'cancelled':
        return <span className='badge badge-muted'>Cancelled</span>;
      default:
        return <span className='badge badge-pending'>Pending</span>;
    }
  };

  const getProcessStatusBadge = (vod) => {
    if (!vod.downloaded || vod.download_status !== 'completed') {
      return null;
    }

    const status = vod.process_status || 'pending';

    if (vod.processed && status === 'completed') {
      return <span className='badge badge-success'>Processed</span>;
    }

    switch (status) {
      case 'processing':
        return <span className='badge badge-info'>Processing</span>;
      case 'failed':
        return <span className='badge badge-error'>Process Failed</span>;
      default:
        return <span className='badge badge-pending'>Ready to Process</span>;
    }
  };

  const renderActions = (vod) => {
    const actions = [];
    const status = vod.download_status || 'pending';
    const inProgress = actionInProgress[vod.id];

    if (status === 'pending' || status === 'cancelled') {
      actions.push(
        <button
          key='download'
          className='action-btn btn-primary'
          onClick={() => handleDownload(vod.id)}
          disabled={!!inProgress}
        >
          {inProgress === 'downloading' ? 'Queueing...' : '▼ Download'}
        </button>
      );
    }

    if (status === 'failed') {
      actions.push(
        <button
          key='retry'
          className='action-btn btn-warning'
          onClick={() => handleRetry(vod.id)}
          disabled={!!inProgress}
        >
          {inProgress === 'retrying' ? 'Retrying...' : '↻ Retry'}
        </button>
      );
    }

    if (vod.downloaded && status === 'completed' && !vod.processed) {
      actions.push(
        <button
          key='process'
          className='action-btn btn-success'
          onClick={() => handleProcess(vod.id)}
          disabled={!!inProgress}
        >
          {inProgress === 'processing' ? 'Processing...' : '⚙ Process'}
        </button>
      );
    }

    return actions.length > 0 ? (
      <div className='vod-actions'>{actions}</div>
    ) : null;
  };

  if (loading) {
    return (
      <div className='card'>
        <h2>VOD Library</h2>
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className='card vod-list'>
      <h2>VOD Library</h2>

      <div className='vod-count'>
        {vods.length} VOD{vods.length !== 1 ? 's' : ''}
      </div>

      <div className='vod-items'>
        {vods.length === 0 ? (
          <div className='empty-state'>
            No VODs found. Run a scan to fetch VODs from Twitch.
          </div>
        ) : (
          vods.map((vod) => (
            <div key={vod.id} className='vod-item'>
              <div className='vod-header'>
                <div className='vod-title'>{vod.title}</div>
                <div className='vod-duration'>{vod.duration}</div>
              </div>
              <div className='vod-meta'>
                <span className='vod-date'>{formatDate(vod.created_at)}</span>
                <div className='vod-badges'>
                  {getDownloadStatusBadge(vod)}
                  {getProcessStatusBadge(vod)}
                </div>
              </div>
              {vod.error_message && (
                <div className='vod-error'>
                  Error: {vod.error_message}
                  {vod.retry_count > 0 && ` (Retry ${vod.retry_count})`}
                </div>
              )}
              {vod.muted_segments &&
                JSON.parse(vod.muted_segments).length > 0 && (
                  <div className='vod-warning'>
                    ⚠ {JSON.parse(vod.muted_segments).length} muted segment(s)
                  </div>
                )}
              {renderActions(vod)}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default VodList;
