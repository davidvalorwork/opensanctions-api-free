FROM node:20-alpine

WORKDIR /app

# Install dependencies first for better caching
COPY package*.json ./
RUN npm install --production

# Copy application files
COPY . .

# Expose the port application runs on
EXPOSE 3000

# Start the application
CMD ["npm", "start"]
