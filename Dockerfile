# ---------- 构建阶段 ----------
FROM node:22-bookworm-slim AS build
# better-sqlite3 预编译二进制不可用时的本地编译兜底
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# 默认使用国内镜像源，可通过 --build-arg NPM_REGISTRY= 覆盖
ARG NPM_REGISTRY=https://registry.npmmirror.com

WORKDIR /app
COPY server/package*.json ./server/
COPY web/package*.json ./web/
RUN cd server && npm ci --no-audit --no-fund --registry=${NPM_REGISTRY} \
    && cd ../web && npm ci --no-audit --no-fund --registry=${NPM_REGISTRY}

COPY server ./server
COPY web ./web
RUN cd server && npm run build \
    && cd ../web && npm run build \
    && cd ../server && npm prune --omit=dev

# ---------- 运行阶段 ----------
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data STATIC_DIR=/app/public PORT=3000
RUN mkdir -p /data
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/data ./data
COPY --from=build /app/web/dist ./public
EXPOSE 3000
VOLUME /data
CMD ["node", "dist/index.js"]
