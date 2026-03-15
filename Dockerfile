FROM node:20-alpine

WORKDIR /app

# Install dependencies first for better caching
COPY package*.json ./
RUN npm install --production

# Copy application files
COPY . .

# Producción: escuchar en 80 para mapeo -p 45001:80. MONGO_URI se pasa al ejecutar el contenedor.
ENV NODE_ENV=production
ENV MONGO_URI=mongodb://136.112.135.115/27017
ENV PORT=80

EXPOSE 80

# Start the application
CMD ["npm", "start"]
