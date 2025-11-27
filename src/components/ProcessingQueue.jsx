import { useServerEvents } from '../state/useServerEvents';
import './ProcessingQueue.css';

function ProcessingQueue() {
  const { vods, processProgress, refreshVods } = useServerEvents();

  const processingVods = vods.filter(
    (v) =>
      v.process_status === 'processing' ||
      (v.downloaded && !v.processed && v.download_status === 'completed')
  );

  const handleProcess = async (vodId) => {
    try {
      await fetch(`/api/vods/${vodId}/process`, { method: 'POST' });
      refreshVods();
    } catch (error) {
      console.error('Failed to process:', error);
    }
  };

  const handleProcessAll = async () => {
    for (const vod of processingVods) {
      if (vod.process_status !== 'processing') {
        try {
          await fetch(`/api/vods/${vod.id}/process`, { method: 'POST' });
        } catch (error) {
          console.error('Failed to process:', error);
        }
      }
    }
    refreshVods();
  };

  return (
    <div className='card processing-queue'>
      <div className='queue-header'>
        <h2>
          <span className='queue-icon'>⚙</span>
          Processing
          {processingVods.length > 0 && (
            <span className='queue-count'>{processingVods.length}</span>
          )}
        </h2>
        {processingVods.filter((v) => v.process_status !== 'processing').length >
          0 && (
          <button className='action-btn btn-success' onClick={handleProcessAll}>
            Process All
          </button>
        )}
      </div>

      <div className='queue-items'>
        {processingVods.length === 0 ? (
          <div className='empty-state'>No VODs to process</div>
        ) : (
          processingVods.map((vod) => {
            const progress = processProgress[vod.id] || {};
            const percent = progress.percent ?? vod.process_progress ?? 0;
            const isProcessing = vod.process_status === 'processing';

            let stageText = 'Ready to process';
            if (isProcessing) {
              stageText = 'Processing...';
              if (progress.stage === 'mute_detection') {
                stageText =
                  progress.segmentsFound > 0
                    ? `Detecting mutes (${progress.segmentsFound} found)`
                    : 'Detecting mutes...';
              } else if (progress.stage === 'extracting_segments') {
                stageText =
                  progress.segment && progress.total
                    ? `Extracting ${progress.segment}/${progress.total}`
                    : 'Extracting segments...';
              } else if (progress.stage === 'concatenating') {
                stageText = 'Joining segments...';
              }
            }

            return (
              <div
                key={vod.id}
                className={`queue-item ${isProcessing ? 'active' : 'pending'}`}
              >
                <div className='queue-item-header'>
                  <span className='queue-item-title'>{vod.title}</span>
                  <span className='queue-item-status'>
                    {isProcessing ? `${percent}%` : 'Ready'}
                  </span>
                </div>

                {isProcessing ? (
                  <>
                    <div className='queue-progress-bar'>
                      <div
                        className='queue-progress-fill'
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <div className='queue-item-details'>
                      <span className='queue-stage'>{stageText}</span>
                    </div>
                  </>
                ) : (
                  <div className='queue-item-actions'>
                    <button
                      className='queue-btn process'
                      onClick={() => handleProcess(vod.id)}
                    >
                      Process Now
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

export default ProcessingQueue;
