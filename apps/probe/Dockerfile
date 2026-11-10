# Skein probe: one run per Railway cron tick (every 10 minutes), then exit. Build context: the repository root.
FROM node:22.20.0-slim
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/probe ./apps/probe
RUN pnpm install --frozen-lockfile --prod --filter "@skein/probe..." && chown -R node:node /app
USER node
WORKDIR /app/apps/probe
CMD ["node", "--import", "tsx", "src/main.ts"]
