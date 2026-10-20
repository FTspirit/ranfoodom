FROM node:20-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-noto-color-emoji ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV CHROME_PATH=/usr/bin/chromium NODE_ENV=production PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY crawler.mjs server.mjs ./
COPY public ./public
USER node
EXPOSE 3000
CMD ["node", "server.mjs"]
