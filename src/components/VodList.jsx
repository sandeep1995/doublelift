import { useState, useEffect } from 'react';
import { useServerEvents } from '../state/useServerEvents';
import './VodList.css';

function VodList() {
  const {
    vods,
    queueStatus,
    playlistVodIds,
    downloadProgress,
    processProgress,
    refreshVods,
    refreshPlaylist,
    refreshQueueStatus,
  } = useServerEvents();
  const [loading, setLoading] = useState(true);
  const [actionInProgress, setActionInProgress] = useState({});

  useEffect(() => {
    if (vods.length > 0 || queueStatus !== null) {
      setLoading(false);
    }
  }, [vods, queueStatus]);

  const handleDownload = async (vodId) => {
    setActionInProgress((prev) => ({ ...prev, [vodId]: 'downloading' }));
    try {
      const response = await fetch(`/api/vods/${vodId}/download`, {
        method: 'POST',
      });
      const result = await response.json();
      if (result.success || result.message) {
        await refreshVods();
      } else {
        throw new Error(
          result.error || result.message || 'Failed to queue download'
        );
      }
    } catch (error) {
      console.error('Failed to queue download:', error);
      // Error will be shown via notifications from websocket
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
        await refreshVods();
      } else {
        throw new Error(
          result.error || result.message || 'Failed to retry download'
        );
      }
    } catch (error) {
      console.error('Failed to retry download:', error);
      // Error will be shown via notifications from websocket
    } finally {
      setActionInProgress((prev) => {
        const newState = { ...prev };
        delete newState[vodId];
        return newState;
      });
    }
  };

  const handleRestartQueue = async () => {
    try {
      const response = await fetch('/api/vods/queue/restart', {
        method: 'POST',
      });
      const result = await response.json();
      if (result.success) {
        await refreshVods();
        await refreshQueueStatus();
      } else {
        throw new Error(
          result.error || result.message || 'Failed to restart queue'
        );
      }
    } catch (error) {
      console.error('Failed to restart queue:', error);
      // Error will be shown via notifications from websocket
    }
  };

  const handleAddToPlaylist = async (vodId) => {
    setActionInProgress((prev) => ({ ...prev, [vodId]: 'adding' }));
    try {
      const response = await fetch(`/api/stream/playlist/${vodId}/add`, {
        method: 'POST',
      });
      const result = await response.json();
      if (result.success) {
        await refreshPlaylist();
        await refreshVods();
      } else {
        throw new Error(
          result.error || result.message || 'Failed to add to playlist'
        );
      }
    } catch (error) {
      console.error('Failed to add to playlist:', error);
      // Error will be shown via notifications from websocket
    } finally {
      setActionInProgress((prev) => {
        const newState = { ...prev };
        delete newState[vodId];
        return newState;
      });
    }
  };

  const handleRemoveFromPlaylist = async (vodId) => {
    setActionInProgress((prev) => ({ ...prev, [vodId]: 'removing' }));
    try {
      const response = await fetch(`/api/stream/playlist/${vodId}/remove`, {
        method: 'POST',
      });
      const result = await response.json();
      if (result.success) {
        await refreshPlaylist();
        await refreshVods();
      } else {
        throw new Error(
          result.error || result.message || 'Failed to remove from playlist'
        );
      }
    } catch (error) {
      console.error('Failed to remove from playlist:', error);
      // Error will be shown via notifications from websocket
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
        await refreshVods();
      } else {
        throw new Error(
          result.error || result.message || 'Failed to process VOD'
        );
      }
    } catch (error) {
      console.error('Failed to process VOD:', error);
      // Error will be shown via notifications from websocket
    } finally {
      setActionInProgress((prev) => {
        const newState = { ...prev };
        delete newState[vodId];
        return newState;
      });
    }
  };

  const handleReprocess = async (vodId) => {
    setActionInProgress((prev) => ({ ...prev, [vodId]: 'reprocessing' }));
    try {
      const response = await fetch(`/api/vods/${vodId}/reprocess`, {
        method: 'POST',
      });
      const result = await response.json();
      if (result.success) {
        await refreshVods();
      } else {
        throw new Error(
          result.error || result.message || 'Failed to reprocess VOD'
        );
      }
    } catch (error) {
      console.error('Failed to reprocess VOD:', error);
      // Error will be shown via notifications from websocket
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
      case 'downloading': {
        const progress = downloadProgress[vod.id];
        const percent = progress?.percent ?? vod.download_progress ?? 0;
        return <span className='badge badge-info'>Downloading {percent}%</span>;
      }
      case 'paused':
        return <span className='badge badge-warning'>Paused</span>;
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

  const getDownloadProgressDetails = (vod) => {
    if (vod.download_status !== 'downloading') {
      return null;
    }

    const progress = downloadProgress[vod.id];
    if (!progress) {
      return null;
    }

    const parts = [];
    if (progress.vodsCount !== null && progress.totalVods !== null) {
      parts.push(`Downloaded ${progress.vodsCount}/${progress.totalVods} VODs`);
    }
    if (progress.percent !== null) {
      parts.push(`${progress.percent}%`);
    }
    if (progress.totalSize) {
      parts.push(`of ${progress.totalSize}`);
    }
    if (progress.speed) {
      parts.push(`at ${progress.speed}`);
    }
    if (progress.eta) {
      parts.push(`ETA ${progress.eta}`);
    }

    if (parts.length === 0) {
      return null;
    }

    return <div className='vod-progress-details'>{parts.join(' ')}</div>;
  };

  const getProcessProgressDetails = (vod) => {
    if (vod.process_status !== 'processing') {
      return null;
    }

    const progress = processProgress[vod.id];
    if (!progress) {
      // Show default processing message if no progress data yet
      return (
        <div className='vod-progress-details'>
          <span className='process-stage'>Processing...</span>
        </div>
      );
    }

    if (progress.stage === 'mute_detection') {
      return (
        <div className='vod-progress-details'>
          <span className='process-stage'>Mute Detection:</span>{' '}
          {progress.message}
          {progress.segmentsFound > 0 && (
            <span className='segments-count'>
              {' '}
              ({progress.segmentsFound} segment
              {progress.segmentsFound !== 1 ? 's' : ''} found)
            </span>
          )}
        </div>
      );
    }

    if (progress.stage === 'extracting_segments') {
      const segmentInfo =
        progress.segment && progress.total
          ? ` (${progress.segment}/${progress.total})`
          : '';
      return (
        <div className='vod-progress-details'>
          <span className='process-stage'>Extracting Segments:</span>{' '}
          {progress.message || `Extracting segments${segmentInfo}...`}
        </div>
      );
    }

    if (progress.stage === 'concatenating') {
      return (
        <div className='vod-progress-details'>
          <span className='process-stage'>Concatenating:</span>{' '}
          {progress.message || 'Merging segments into final video...'}
        </div>
      );
    }

    if (progress.message) {
      return (
        <div className='vod-progress-details'>
          <span className='process-stage'>Processing:</span> {progress.message}
        </div>
      );
    }

    return (
      <div className='vod-progress-details'>
        <span className='process-stage'>Processing...</span>
      </div>
    );
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

  const handlePause = async (vodId) => {
    setActionInProgress((prev) => ({ ...prev, [vodId]: 'pausing' }));
    try {
      const response = await fetch(`/api/vods/${vodId}/pause`, {
        method: 'POST',
      });
      const result = await response.json();
      if (result.success) {
        await refreshVods();
      } else {
        throw new Error(
          result.error || result.message || 'Failed to pause download'
        );
      }
    } catch (error) {
      console.error('Failed to pause download:', error);
      // Error will be shown via notifications from websocket
    } finally {
      setActionInProgress((prev) => {
        const newState = { ...prev };
        delete newState[vodId];
        return newState;
      });
    }
  };

  const handleResume = async (vodId) => {
    setActionInProgress((prev) => ({ ...prev, [vodId]: 'resuming' }));
    try {
      const response = await fetch(`/api/vods/${vodId}/resume`, {
        method: 'POST',
      });
      const result = await response.json();
      if (result.success) {
        await refreshVods();
      } else {
        throw new Error(
          result.error || result.message || 'Failed to resume download'
        );
      }
    } catch (error) {
      console.error('Failed to resume download:', error);
      // Error will be shown via notifications from websocket
    } finally {
      setActionInProgress((prev) => {
        const newState = { ...prev };
        delete newState[vodId];
        return newState;
      });
    }
  };

  const handleStop = async (vodId) => {
    setActionInProgress((prev) => ({ ...prev, [vodId]: 'stopping' }));
    try {
      const response = await fetch(`/api/vods/${vodId}/stop`, {
        method: 'POST',
      });
      const result = await response.json();
      if (result.success) {
        await refreshVods();
      } else {
        throw new Error(
          result.error || result.message || 'Failed to stop download'
        );
      }
    } catch (error) {
      console.error('Failed to stop download:', error);
      // Error will be shown via notifications from websocket
    } finally {
      setActionInProgress((prev) => {
        const newState = { ...prev };
        delete newState[vodId];
        return newState;
      });
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
          {inProgress === 'downloading' ? 'Queueing...' : 'Download'}
        </button>
      );
    }

    if (status === 'downloading') {
      actions.push(
        <button
          key='pause'
          className='action-btn btn-warning'
          onClick={() => handlePause(vod.id)}
          disabled={!!inProgress}
        >
          {inProgress === 'pausing' ? 'Pausing...' : 'Pause'}
        </button>
      );
      actions.push(
        <button
          key='stop'
          className='action-btn btn-danger'
          onClick={() => handleStop(vod.id)}
          disabled={!!inProgress}
        >
          {inProgress === 'stopping' ? 'Stopping...' : 'Stop'}
        </button>
      );
    }

    if (status === 'paused') {
      actions.push(
        <button
          key='resume'
          className='action-btn btn-success'
          onClick={() => handleResume(vod.id)}
          disabled={!!inProgress}
        >
          {inProgress === 'resuming' ? 'Resuming...' : 'Resume'}
        </button>
      );
      actions.push(
        <button
          key='stop'
          className='action-btn btn-danger'
          onClick={() => handleStop(vod.id)}
          disabled={!!inProgress}
        >
          {inProgress === 'stopping' ? 'Stopping...' : 'Stop'}
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
          {inProgress === 'retrying' ? 'Retrying...' : 'Retry'}
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
          {inProgress === 'processing' ? 'Processing...' : 'Process'}
        </button>
      );
    }

    if (vod.processed && status === 'completed') {
      actions.push(
        <button
          key='reprocess'
          className='action-btn btn-info'
          onClick={() => handleReprocess(vod.id)}
          disabled={!!inProgress}
          title='Reprocess video to re-detect muted segments'
        >
          {inProgress === 'reprocessing' ? 'Reprocessing...' : 'Reprocess'}
        </button>
      );

      const inPlaylist = playlistVodIds.has(vod.id);
      if (inPlaylist) {
        actions.push(
          <button
            key='remove-playlist'
            className='action-btn btn-warning'
            onClick={() => handleRemoveFromPlaylist(vod.id)}
            disabled={!!inProgress}
          >
            {inProgress === 'removing' ? 'Removing...' : 'Remove from Playlist'}
          </button>
        );
      } else {
        actions.push(
          <button
            key='add-playlist'
            className='action-btn btn-success'
            onClick={() => handleAddToPlaylist(vod.id)}
            disabled={!!inProgress}
          >
            {inProgress === 'adding' ? 'Adding...' : 'Add to Playlist'}
          </button>
        );
      }
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
      <div className='vod-list-header'>
        <h2>VOD Library</h2>
        {queueStatus && queueStatus.queued > 0 && (
          <button
            className='action-btn btn-info'
            onClick={handleRestartQueue}
            title='Restart download queue processing'
          >
            Restart Queue ({queueStatus.queued})
          </button>
        )}
      </div>

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
              {getDownloadProgressDetails(vod)}
              {getProcessProgressDetails(vod)}
              {vod.error_message && (
                <div className='vod-error'>
                  <span>
                    Error: {vod.error_message}
                    {vod.retry_count > 0 && ` (Retry ${vod.retry_count})`}
                  </span>
                  <button
                    className='vod-error-clear'
                    onClick={async () => {
                      try {
                        const response = await fetch(
                          `/api/vods/${vod.id}/clear-error`,
                          {
                            method: 'POST',
                          }
                        );
                        const result = await response.json();
                        if (result.success) {
                          await refreshVods();
                        }
                      } catch (error) {
                        console.error('Failed to clear error:', error);
                      }
                    }}
                    title='Clear error message'
                  >
                    ×
                  </button>
                </div>
              )}
              {vod.muted_segments &&
                JSON.parse(vod.muted_segments).length > 0 && (
                  <div className='vod-warning'>
                    {JSON.parse(vod.muted_segments).length} muted segment(s)
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
