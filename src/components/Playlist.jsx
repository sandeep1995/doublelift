import { useState, useEffect } from 'react';
import './Playlist.css';

function Playlist() {
  const [playlist, setPlaylist] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    fetchPlaylist();
    const interval = setInterval(fetchPlaylist, 3000);

    // Listen for playlist updates via WebSocket
    const websocket = new WebSocket(`ws://${window.location.hostname}:3000`);
    websocket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'playlist_updated') {
        fetchPlaylist();
      }
    };

    return () => {
      clearInterval(interval);
      websocket.close();
    };
  }, []);

  const fetchPlaylist = async () => {
    try {
      const response = await fetch('/api/stream/playlist');
      const data = await response.json();
      setPlaylist(data);
    } catch (error) {
      console.error('Failed to fetch playlist:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePlaylist = async () => {
    setUpdating(true);
    try {
      const response = await fetch('/api/stream/playlist/update', {
        method: 'POST',
      });
      const result = await response.json();
      if (result.success) {
        await fetchPlaylist();
        alert('Playlist updated! All processed VODs have been added.');
      } else {
        alert('Failed to update playlist: ' + (result.error || result.message));
      }
    } catch (error) {
      console.error('Failed to update playlist:', error);
      alert('Failed to update playlist: ' + error.message);
    } finally {
      setUpdating(false);
    }
  };

  const calculateTotalDuration = () => {
    let totalSeconds = 0;
    playlist.forEach((item) => {
      const match = item.duration.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
      const hours = parseInt(match[1] || 0);
      const minutes = parseInt(match[2] || 0);
      const seconds = parseInt(match[3] || 0);
      totalSeconds += hours * 3600 + minutes * 60 + seconds;
    });
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  if (loading) {
    return (
      <div className='card'>
        <h2>Current Playlist</h2>
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className='card playlist'>
      <div className='playlist-header'>
        <h2>Current Playlist</h2>
        <button
          className='action-btn btn-primary'
          onClick={handleUpdatePlaylist}
          disabled={updating}
        >
          {updating ? 'Updating...' : '🔄 Update Playlist'}
        </button>
      </div>

      {playlist.length > 0 && (
        <div className='playlist-summary'>
          <div className='summary-item'>
            <span className='summary-label'>Total VODs:</span>
            <span className='summary-value'>{playlist.length}</span>
          </div>
          <div className='summary-item'>
            <span className='summary-label'>Total Duration:</span>
            <span className='summary-value'>{calculateTotalDuration()}</span>
          </div>
        </div>
      )}

      <div className='playlist-items'>
        {playlist.length === 0 ? (
          <div className='empty-state'>
            No VODs in playlist. Process some VODs to build the playlist.
          </div>
        ) : (
          playlist.map((item, index) => (
            <div key={item.id} className='playlist-item'>
              <div className='playlist-position'>{index + 1}</div>
              <div className='playlist-content'>
                <div className='playlist-title'>{item.title}</div>
                <div className='playlist-duration'>{item.duration}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default Playlist;
