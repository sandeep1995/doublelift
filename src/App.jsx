import { useServerEvents } from './state/useServerEvents';
import Dashboard from './components/Dashboard';
import StreamControls from './components/StreamControls';
import VodList from './components/VodList';
import Playlist from './components/Playlist';
import DownloadQueue from './components/DownloadQueue';
import ProcessingQueue from './components/ProcessingQueue';
import ActivityLog from './components/ActivityLog';
import Notifications from './components/Notifications';
import './App.css';

function App() {
  const {
    status,
    logs,
    errors,
    dismissError,
    clearErrors,
    refreshStatus,
  } = useServerEvents();

  return (
    <div className='app'>
      <header className='header'>
        <div className='header-content'>
          <h1>DoubleLift VOD Streamer</h1>
          <div className='header-subtitle'>
            Automated Twitch Rerun Channel Manager
          </div>
        </div>
      </header>

      <div className='container'>
        <Notifications errors={errors} onDismiss={dismissError} onClear={clearErrors} />
        <Dashboard status={status} />
        <StreamControls status={status} onUpdate={refreshStatus} />

        <div className='two-column'>
          <DownloadQueue />
          <ProcessingQueue />
        </div>

        <div className='two-column'>
          <VodList />
          <Playlist />
        </div>

        <ActivityLog logs={logs} />
      </div>
    </div>
  );
}

export default App;
