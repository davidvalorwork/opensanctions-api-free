#!/bin/bash

# Navigate to the project root directory
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR" || exit

echo "==================================================="
echo "Testing Docker Setup & Cleaning Up"
echo "==================================================="

# 1. Start the services using docker-compose
echo -e "\n[1/4] Starting the containers in detached mode..."
docker-compose up -d

# 2. Waiting for the API to be ready
echo -e "\n[2/4] Waiting for the services to initialize (10 seconds)..."
sleep 10

# 3. Test the API endpoint
echo -e "\n[3/4] Testing the API /health endpoint..."
echo "Running: curl -s http://localhost:3000/health"
RESPONSE=$(curl -s http://localhost:3000/health)

echo -e "\nServer Response:"
echo "$RESPONSE"

# Simple check to see if we got the expected "ok" status
if echo "$RESPONSE" | grep -q '"status":"ok"'; then
    echo "✅ TEST PASSED: The API is up and running correctly."
else
    echo "❌ TEST FAILED: The API did not respond with the expected status."
    echo "Checking API logs for errors:"
    docker-compose logs api
fi

# 4. Cleanup and remove all containers, networks, and volumes
echo -e "\n[4/4] Cleaning up: stopping containers and removing volumes..."
docker-compose down -v

echo -e "\n🎉 Process finished. Everything is clean."
echo "==================================================="
