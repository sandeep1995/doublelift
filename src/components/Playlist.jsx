import { useState, useEffect } from 'react';
import './Playlist.css';

function Playlist() {
  const [playlist, setPlaylist] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPlaylist();
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
      <h2>Current Playlist</h2>

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
