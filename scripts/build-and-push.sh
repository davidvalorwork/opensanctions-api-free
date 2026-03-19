#!/bin/bash

# Navigate to the project root directory (one level up from where this script is located)
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR" || exit

# Define the image name
IMAGE_NAME="sipconsulting/reposip:rg-dev-opensanctions"

echo "==================================================="
echo "Building and Pushing Docker Image"
echo "Target Image: $IMAGE_NAME"
echo "Working Directory: $PROJECT_DIR"
echo "==================================================="

# 1. Build the Docker image
echo -e "\n[1/3] Building the Docker image..."
docker build --platform linux/amd64 -t "$IMAGE_NAME" .

# Check if build was successful
if [ $? -ne 0 ]; then
    echo "❌ Error building the image. Aborting."
    exit 1
fi
echo "✅ Build completed successfully."

# 2. Login verification reminder
echo -e "\n[2/3] Preparing to push..."
echo "⚠️  Ensure you are logged into Docker (run 'docker login' beforehand if needed)."

# 3. Push the Docker image
echo -e "\n[3/3] Pushing image to the repository..."
docker push "$IMAGE_NAME"

# Check if push was successful
if [ $? -ne 0 ]; then
    echo "❌ Error pushing the image. Check your credentials and permissions."
    exit 1
fi

echo -e "\n🎉 Image successfully built and pushed to: $IMAGE_NAME"
echo "==================================================="
