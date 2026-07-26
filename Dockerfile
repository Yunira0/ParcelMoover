# syntax=docker/dockerfile:1

#######################################
# Stage 1 — build the client (Vite/React)
#######################################
FROM node:20-alpine AS client-build
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

#######################################
# Stage 2 — install ALL server deps (including dev), generate Prisma, compile TS
#######################################
FROM node:20-alpine AS server-build
RUN apk add --no-cache openssl
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/ ./
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
RUN npx prisma generate
RUN npm run build
RUN cp src/generated/prisma/*.so.node dist/generated/prisma/

#######################################
# Stage 3 — production-only server deps (no devDependencies)
#######################################
FROM node:20-alpine AS prod-deps
RUN apk add --no-cache openssl
WORKDIR /app
COPY server/package.json server/package-lock.json ./
# sharp ships multi-platform native binaries by default; restrict to musl/x64
# so we don't pull in glibc binaries that will never be used on Alpine.
ENV SHARP_IGNORE_GLOBAL_LIBVIPS=1
RUN npm ci --omit=dev

#######################################
# Stage 4 — runtime image (production deps only)
#######################################
FROM node:20-alpine AS runtime
RUN apk add --no-cache openssl tini \
  && addgroup -S app && adduser -S app -G app

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=server-build /app/package.json ./package.json
COPY --from=server-build /app/dist ./dist
COPY --from=server-build /app/prisma ./prisma
COPY --from=server-build /app/prisma.config.ts ./prisma.config.ts
# server.ts does `express.static("public")` — this is where the built SPA lives.
COPY --from=client-build /app/client/dist ./public

RUN mkdir -p uploads && chown -R app:app /app
USER app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# tini as PID 1 for correct SIGTERM forwarding / zombie reaping.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
