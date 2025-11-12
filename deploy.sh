#!/bin/bash

echo "DoubleLift VOD Streamer - Deployment Script"
echo "==========================================="

if [ ! -f .env ]; then
    echo "Error: .env file not found!"
    echo "Please copy env.example to .env and configure your settings."
    exit 1
fi

echo "Installing system dependencies..."
if command -v apt-get &> /dev/null; then
    sudo apt-get update
    sudo apt-get install -y ffmpeg nodejs npm docker.io docker-compose
elif command -v yum &> /dev/null; then
    sudo yum install -y epel-release
    sudo yum install -y ffmpeg nodejs npm docker docker-compose
elif command -v brew &> /dev/null; then
    brew install ffmpeg node
fi

echo "Installing Node.js dependencies..."
npm install

echo "Building frontend..."
npm run build

echo "Starting services with Docker Compose..."
docker-compose up -d

echo ""
echo "Deployment complete!"
echo ""
echo "The application is now running at http://localhost:3000"
echo ""
echo "To view logs: docker-compose logs -f"
echo "To stop: docker-compose down"
echo ""

