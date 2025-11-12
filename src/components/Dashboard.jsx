import './Dashboard.css';

function Dashboard({ status }) {
  if (!status) {
    return (
      <div className='card'>
        <h2>Dashboard</h2>
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className='card dashboard'>
      <h2>Dashboard</h2>

      <div className='stream-status'>
        <div className='status-label'>Stream Status</div>
        <span
          className={`status-badge ${
            status.isStreaming ? 'status-live' : 'status-offline'
          }`}
        >
          {status.isStreaming ? 'LIVE' : 'OFFLINE'}
        </span>
      </div>

      <div className='stat-grid'>
        <div className='stat-item'>
          <div className='stat-label'>Total VODs</div>
          <div className='stat-value'>{status.stats?.totalVods || 0}</div>
        </div>
        <div className='stat-item'>
          <div className='stat-label'>Downloaded</div>
          <div className='stat-value'>{status.stats?.downloadedVods || 0}</div>
        </div>
        <div className='stat-item'>
          <div className='stat-label'>Processed</div>
          <div className='stat-value'>{status.stats?.processedVods || 0}</div>
        </div>
        <div className='stat-item'>
          <div className='stat-label'>In Playlist</div>
          <div className='stat-value'>{status.stats?.playlistCount || 0}</div>
        </div>
      </div>

      {status.lastScan && (
        <div className='info-row'>
          <span className='info-label'>Last Scan:</span>
          <span className='info-value'>
            {new Date(status.lastScan).toLocaleString()}
          </span>
        </div>
      )}

      {status.playlistUpdated && (
        <div className='info-row'>
          <span className='info-label'>Playlist Updated:</span>
          <span className='info-value'>
            {new Date(status.playlistUpdated).toLocaleString()}
          </span>
        </div>
      )}
    </div>
  );
}

export default Dashboard;
