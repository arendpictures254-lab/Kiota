# Kiota: one image build, three targets.
#   builder   - installs everything and builds the app
#   migrator  - runs database migrations as the OWNER, then exits (docker compose service "migrate")
#   runner    - the small production server, runs as the app role kiota_app
# See docs/deploy.md.

FROM node:24-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# ---- builder ---------------------------------------------------------------
FROM base AS builder
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci
COPY . .
# The two public addresses are baked into the static site pages at build time.
ARG SITE_URL=https://kiota.app
ARG APP_URL=https://app.kiota.app
ENV SITE_URL=$SITE_URL APP_URL=$APP_URL
RUN npx prisma generate && npm run build

# ---- migrator --------------------------------------------------------------
FROM builder AS migrator
# Applies migrations as the owner, syncs the permission catalogue, sets the kiota_app password.
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx scripts/deploy-setup.ts"]

# ---- runner ----------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
# Uploaded files live on a volume mounted here; .dev holds the console SMS log on staging.
RUN mkdir -p /data/storage /app/.dev && chown -R node:node /data /app/.dev
ENV LOCAL_STORAGE_DIR=/data/storage
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
