FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/app/data \
    DIST_DIR=/app/dist \
    NODE_NO_WARNINGS=1

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/dist ./dist

RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
VOLUME /app/data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- "http://127.0.0.1:3000${BASE_PATH:-/buylist}/api/health" >/dev/null || exit 1

CMD ["node", "server/index.js"]
