import { useState, useEffect } from 'react';
import './VodList.css';

function VodList() {
  const [vods, setVods] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchVods();
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

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  if (loading) {
    return (
      <div className='card'>
        <h2>📹 VOD Library</h2>
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className='card vod-list'>
      <h2>📹 VOD Library</h2>

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
                  {vod.downloaded ? (
                    <span className='badge badge-success'>Downloaded</span>
                  ) : (
                    <span className='badge badge-pending'>Pending</span>
                  )}
                  {vod.processed ? (
                    <span className='badge badge-success'>Processed</span>
                  ) : null}
                </div>
              </div>
              {vod.muted_segments &&
                JSON.parse(vod.muted_segments).length > 0 && (
                  <div className='vod-warning'>
                    ⚠️ {JSON.parse(vod.muted_segments).length} muted segment(s)
                  </div>
                )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default VodList;
