# --- build stage ---
FROM node:20-bookworm AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
COPY web ./web
RUN cd web && npm ci && npm run build

# --- runtime stage ---
FROM node:20-bookworm-slim
WORKDIR /app
# 系统依赖:ffmpeg + python(yt-dlp)+ curl(装 BaiduPCS-Go)
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg python3 curl ca-certificates \
 && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
 && chmod a+rx /usr/local/bin/yt-dlp \
 && curl -L https://github.com/qjfoidnh/BaiduPCS-Go/releases/download/v3.9.7/BaiduPCS-Go-v3.9.7-linux-amd64.zip -o /tmp/b.zip \
 && apt-get install -y --no-install-recommends unzip \
 && unzip /tmp/b.zip -d /tmp/b && cp /tmp/b/*/BaiduPCS-Go /usr/local/bin/BaiduPCS-Go \
 && chmod a+rx /usr/local/bin/BaiduPCS-Go \
 && rm -rf /tmp/b /tmp/b.zip \
 && apt-get purge -y unzip && apt-get clean && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/web/dist ./web/dist
ENV CONFIG_PATH=/config/config.yaml
EXPOSE 8080
CMD ["node", "dist/index.js"]
