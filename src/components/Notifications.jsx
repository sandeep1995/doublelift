import { useEffect } from 'react';
import './Notifications.css';

function Notifications({ errors, onDismiss, onClear }) {
  useEffect(() => {
    // Auto-dismiss errors after 10 seconds
    errors.forEach((error) => {
      if (!error.dismissed) {
        const timer = setTimeout(() => {
          onDismiss(error.id);
        }, 10000);
        return () => clearTimeout(timer);
      }
    });
  }, [errors, onDismiss]);

  if (errors.length === 0) {
    return null;
  }

  return (
    <div className='notifications-container'>
      <div className='notifications-header'>
        <span className='notifications-title'>
          {errors.length} Error{errors.length !== 1 ? 's' : ''}
        </span>
        <button
          className='notifications-clear-btn'
          onClick={onClear}
          title='Clear all errors'
        >
          Clear All
        </button>
      </div>
      <div className='notifications-list'>
        {errors.slice(0, 5).map((error) => (
          <div
            key={error.id}
            className={`notification notification-${error.type || 'error'}`}
          >
            <div className='notification-content'>
              <div className='notification-message'>{error.message}</div>
              {error.endpoint && (
                <div className='notification-endpoint'>{error.endpoint}</div>
              )}
              {error.vodId && (
                <div className='notification-vod-id'>VOD ID: {error.vodId}</div>
              )}
            </div>
            <button
              className='notification-dismiss'
              onClick={() => onDismiss(error.id)}
              title='Dismiss'
            >
              ×
            </button>
          </div>
        ))}
        {errors.length > 5 && (
          <div className='notification-more'>
            +{errors.length - 5} more error{errors.length - 5 !== 1 ? 's' : ''}
          </div>
        )}
      </div>
    </div>
  );
}

export default Notifications;

