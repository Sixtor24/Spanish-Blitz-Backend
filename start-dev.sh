#!/bin/bash

# Spanish Blitz Backend - Development Start Script

echo "🚀 Starting Spanish Blitz Backend..."
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "❌ Error: .env file not found!"
    echo "Please copy .env.example to .env and configure it."
    exit 1
fi

# Check if node_modules exists
if [ ! -d node_modules ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

echo "✅ Starting development server..."
echo "📍 Backend will be available at: http://localhost:3001"
echo "📊 Health check: http://localhost:3001/api/health"
echo ""
echo "Press Ctrl+C to stop"
echo ""

npm run dev

