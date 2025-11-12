import './ActivityLog.css';

function ActivityLog({ logs }) {
  return (
    <div className='card activity-log'>
      <h2>Activity Log</h2>

      <div className='log-items'>
        {logs.length === 0 ? (
          <div className='empty-state'>No activity yet</div>
        ) : (
          logs.map((log, index) => (
            <div key={index} className='log-item'>
              <span className='log-time'>
                {new Date(log.timestamp).toLocaleTimeString()}
              </span>
              <span className='log-message'>{log.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default ActivityLog;
