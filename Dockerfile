# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS deps
WORKDIR /app
ENV NODE_ENV=production \
    NPM_CONFIG_LOGLEVEL=warn \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev --ignore-scripts; \
    else \
      npm install --omit=dev --ignore-scripts --no-package-lock; \
    fi

FROM node:20-alpine AS runtime
ENV NODE_ENV=production \
    NPM_CONFIG_LOGLEVEL=warn
WORKDIR /app

RUN addgroup -S app && adduser -S -G app -h /app app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

RUN chown -R app:app /app
USER app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
