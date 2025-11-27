import { useServerEvents } from '../state/useServerEvents';
import './DownloadQueue.css';

function DownloadQueue() {
  const { vods, downloadProgress, refreshVods } = useServerEvents();

  const downloadingVods = vods.filter(
    (v) => v.download_status === 'downloading'
  );

  const handlePause = async (vodId) => {
    try {
      await fetch(`/api/vods/${vodId}/pause`, { method: 'POST' });
      refreshVods();
    } catch (error) {
      console.error('Failed to pause:', error);
    }
  };

  const handleStop = async (vodId) => {
    try {
      await fetch(`/api/vods/${vodId}/stop`, { method: 'POST' });
      refreshVods();
    } catch (error) {
      console.error('Failed to stop:', error);
    }
  };

  return (
    <div className='card download-queue'>
      <h2>
        <span className='queue-icon'>⬇</span>
        Downloading
        {downloadingVods.length > 0 && (
          <span className='queue-count'>{downloadingVods.length}</span>
        )}
      </h2>

      <div className='queue-items'>
        {downloadingVods.length === 0 ? (
          <div className='empty-state'>No active downloads</div>
        ) : (
          downloadingVods.map((vod) => {
            const progress = downloadProgress[vod.id] || {};
            const percent = progress.percent ?? vod.download_progress ?? 0;

            return (
              <div key={vod.id} className='queue-item active'>
                <div className='queue-item-header'>
                  <span className='queue-item-title'>{vod.title}</span>
                  <span className='queue-item-status'>{percent}%</span>
                </div>

                <div className='queue-progress-bar'>
                  <div
                    className='queue-progress-fill'
                    style={{ width: `${percent}%` }}
                  />
                </div>
                <div className='queue-item-details'>
                  {progress.speed && (
                    <span className='queue-speed'>{progress.speed}</span>
                  )}
                  {progress.eta && (
                    <span className='queue-eta'>ETA {progress.eta}</span>
                  )}
                  {progress.totalSize && (
                    <span className='queue-size'>{progress.totalSize}</span>
                  )}
                </div>

                <div className='queue-item-actions'>
                  <button
                    className='queue-btn pause'
                    onClick={() => handlePause(vod.id)}
                  >
                    Pause
                  </button>
                  <button
                    className='queue-btn stop'
                    onClick={() => handleStop(vod.id)}
                  >
                    Stop
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default DownloadQueue;
