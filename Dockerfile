FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache wget \
  && addgroup -S appgroup && adduser -S appuser -G appgroup

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src ./src
RUN mkdir -p data && chown -R appuser:appgroup /app

USER appuser

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" || exit 1

CMD ["npm", "start"]
