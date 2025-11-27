import { useState } from 'react';
import { useServerEvents } from '../state/useServerEvents';
import './VodList.css';

function VodList() {
  const { vods, refreshVods } = useServerEvents();
  const [actionInProgress, setActionInProgress] = useState({});

  const pendingVods = vods.filter(
    (v) =>
      v.download_status === 'pending' ||
      v.download_status === 'queued' ||
      v.download_status === 'cancelled' ||
      v.download_status === 'failed'
  );

  const handleDownload = async (vodId) => {
    setActionInProgress((prev) => ({ ...prev, [vodId]: 'downloading' }));
    try {
      await fetch(`/api/vods/${vodId}/download`, { method: 'POST' });
      await refreshVods();
    } catch (error) {
      console.error('Failed to queue download:', error);
    } finally {
      setActionInProgress((prev) => {
        const newState = { ...prev };
        delete newState[vodId];
        return newState;
      });
    }
  };

  const handleDownloadAll = async () => {
    for (const vod of pendingVods) {
      if (vod.download_status === 'pending') {
        try {
          await fetch(`/api/vods/${vod.id}/download`, { method: 'POST' });
        } catch (error) {
          console.error('Failed to queue:', error);
        }
      }
    }
    await refreshVods();
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className='card vod-list'>
      <div className='vod-list-header'>
        <h2>VOD Library</h2>
        {pendingVods.filter((v) => v.download_status === 'pending').length >
          0 && (
          <button
            className='action-btn btn-primary'
            onClick={handleDownloadAll}
          >
            Download All
          </button>
        )}
      </div>

      <div className='vod-count'>
        {pendingVods.length} pending VOD{pendingVods.length !== 1 ? 's' : ''}
      </div>

      <div className='vod-items'>
        {pendingVods.length === 0 ? (
          <div className='empty-state'>No pending VODs</div>
        ) : (
          pendingVods.map((vod) => {
            const inProgress = actionInProgress[vod.id];
            const isFailed = vod.download_status === 'failed';
            const isQueued = vod.download_status === 'queued';

            return (
              <div
                key={vod.id}
                className={`vod-item ${isFailed ? 'failed' : ''} ${
                  isQueued ? 'queued' : ''
                }`}
              >
                <div className='vod-header'>
                  <div className='vod-title'>{vod.title}</div>
                  <div className='vod-duration'>{vod.duration}</div>
                </div>
                <div className='vod-meta'>
                  <span className='vod-date'>{formatDate(vod.created_at)}</span>
                  {isQueued && <span className='badge badge-info'>Queued</span>}
                  {isFailed && (
                    <span className='badge badge-error'>Failed</span>
                  )}
                  {vod.muted_segments &&
                    JSON.parse(vod.muted_segments).length > 0 && (
                      <span className='badge badge-warning'>
                        {JSON.parse(vod.muted_segments).length} muted
                      </span>
                    )}
                </div>
                {vod.error_message && (
                  <div className='vod-error'>{vod.error_message}</div>
                )}
                {!isQueued && (
                  <div className='vod-actions'>
                    <button
                      className='action-btn btn-primary'
                      onClick={() => handleDownload(vod.id)}
                      disabled={!!inProgress}
                    >
                      {inProgress
                        ? 'Queueing...'
                        : isFailed
                        ? 'Retry'
                        : 'Download'}
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default VodList;
