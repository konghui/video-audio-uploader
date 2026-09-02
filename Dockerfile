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
# 系统依赖:ffmpeg + python(yt-dlp)+ deno(yt-dlp 解 YouTube JS)+ curl/unzip
# 二进制按架构选择(amd64 / arm64),否则在 Apple Silicon 等 arm64 上无法执行
ARG BAIDUPCS_VERSION=v4.0.2
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg python3 curl ca-certificates unzip \
 && arch="$(dpkg --print-architecture)" \
 && case "$arch" in \
      amd64) pcs_arch=amd64; deno_arch=x86_64-unknown-linux-gnu ;; \
      arm64) pcs_arch=arm64; deno_arch=aarch64-unknown-linux-gnu ;; \
      *) echo "unsupported arch: $arch" && exit 1 ;; \
    esac \
 && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
 && chmod a+rx /usr/local/bin/yt-dlp \
 && curl -L "https://github.com/denoland/deno/releases/latest/download/deno-${deno_arch}.zip" -o /tmp/deno.zip \
 && unzip /tmp/deno.zip -d /usr/local/bin && chmod a+rx /usr/local/bin/deno \
 && curl -L "https://github.com/qjfoidnh/BaiduPCS-Go/releases/download/${BAIDUPCS_VERSION}/BaiduPCS-Go-${BAIDUPCS_VERSION}-linux-${pcs_arch}.zip" -o /tmp/b.zip \
 && unzip /tmp/b.zip -d /tmp/b && cp /tmp/b/*/BaiduPCS-Go /usr/local/bin/BaiduPCS-Go \
 && chmod a+rx /usr/local/bin/BaiduPCS-Go \
 && rm -rf /tmp/b /tmp/b.zip /tmp/deno.zip \
 && apt-get purge -y unzip && apt-get clean && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/web/dist ./web/dist
ENV CONFIG_PATH=/config/config.yaml
EXPOSE 8080
CMD ["node", "dist/index.js"]
