# DoubleLift VOD Streamer - Setup Instructions

This application automatically manages your Twitch rerun channel by:

- Scanning for new VODs from your main channel daily at midnight
- Detecting and removing muted segments (DMCA/copyright)
- Creating 48-hour playlists from recent streams
- Continuously streaming to your rerun channel

## REQUIREMENTS:

1. A VPS or cloud server (recommended specs: 4GB RAM, 2 CPU cores, 100GB storage)
2. Twitch account with Developer Application credentials
3. Stream key for your rerun channel
4. Node.js 18+ and FFmpeg installed

## GETTING TWITCH CREDENTIALS:

1. Go to https://dev.twitch.tv/console/apps
2. Click "Register Your Application"
3. Name: "DoubleLift VOD Streamer"
4. OAuth Redirect URLs: http://localhost
5. Category: Broadcasting Suite
6. Click "Create"
7. Copy your Client ID
8. Click "New Secret" and copy the Client Secret

## GETTING YOUR CHANNEL ID:

1. Go to https://www.streamweasels.com/tools/convert-twitch-username-to-user-id/
2. Enter your Twitch username
3. Copy the User ID

## GETTING YOUR STREAM KEY:

1. Go to https://dashboard.twitch.tv/settings/stream
2. Under "Primary Stream key", click "Copy"

## INSTALLATION:

## Option 1: Using Docker (Recommended)

1. Install Docker and Docker Compose on your server
2. Clone/upload this project to your server
3. Copy env.example to .env:
   cp env.example .env

4. Edit .env and add your credentials:
   nano .env

5. Start the service:
   docker-compose up -d

6. Access the dashboard:
   http://your-server-ip:3000

## Option 2: Manual Installation

1. Install Node.js 18+ and FFmpeg:
   Ubuntu/Debian:
   sudo apt update
   sudo apt install -y nodejs npm ffmpeg

   CentOS/RHEL:
   sudo yum install -y epel-release
   sudo yum install -y nodejs npm ffmpeg

2. Clone/upload this project to your server

3. Copy env.example to .env:
   cp env.example .env

4. Edit .env with your credentials:
   nano .env

5. Install dependencies:
   npm install

6. Build the frontend:
   npm run build

7. Start the server:
   npm start

   Or use the systemd service for automatic startup:
   sudo cp systemd/doublelift.service /etc/systemd/system/
   sudo systemctl enable doublelift
   sudo systemctl start doublelift

## CONFIGURATION:

Edit .env file with these settings:

TWITCH_CLIENT_ID=your_client_id_here
TWITCH_CLIENT_SECRET=your_client_secret_here
TWITCH_CHANNEL_ID=your_channel_id_here
TWITCH_RERUN_STREAM_KEY=your_stream_key_here
TWITCH_RERUN_CHANNEL=triplelift

SCAN_SCHEDULE=0 0 \* \* \* # Runs daily at midnight
PORT=3000

## USING THE APPLICATION:

1. Open the dashboard at http://your-server-ip:3000

2. The system will automatically:

   - Scan for new VODs at midnight
   - Download and process VODs (removing muted segments)
   - Build a 48-hour playlist
   - You can also trigger manual scans

3. To start streaming:

   - Click "Start Stream" in the dashboard
   - The stream will continuously loop through your 48-hour playlist
   - Monitor progress in the Activity Log

4. The stream will:
   - Run 24/7 until you stop it
   - Automatically restart if interrupted
   - Update playlist when new VODs are processed

## STORAGE REQUIREMENTS:

- Each hour of VOD: ~1-2GB
- 48 hours of content: ~50-100GB
- Recommended: 100GB+ storage for buffering

## BANDWIDTH REQUIREMENTS:

- Streaming at 6Mbps (standard Twitch quality)
- ~2.7GB per hour of streaming
- ~65GB per day for 24/7 streaming
- Use a server with unmetered bandwidth if possible

## TROUBLESHOOTING:

- Check logs: docker-compose logs -f (Docker)
  or: journalctl -u doublelift -f (systemd)

- If VODs won't download: Check Twitch API credentials

- If stream won't start: Verify stream key is correct

- If muted segments aren't detected: This is normal for some VODs,
  the Twitch API may not always return this data immediately

## COST ESTIMATE:

Running this on a VPS:

- Digital Ocean Droplet (4GB RAM, 2 CPU, 100GB): $24/month
- Linode (4GB RAM, 2 CPU, 80GB): $24/month
- AWS EC2 t3.medium + 100GB EBS: ~$35-40/month
- Hetzner Cloud CX21 (4GB RAM, 2 CPU, 80GB): €9.51/month (~$10)

You do NOT need to dedicate a physical PC. Everything runs on a cloud server.

## SECURITY NOTES:

- Keep your .env file secure
- Never commit .env to git
- Use a firewall to restrict access to port 3000
- Consider setting up nginx with SSL/HTTPS
- Rotate your Twitch stream key periodically

## SUPPORT:

For issues or questions:

- Check the Activity Log in the dashboard
- Review server logs
- Verify all credentials are correct
- Ensure FFmpeg is properly installed
