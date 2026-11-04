# Skein API. Build context: the repository root.
FROM node:22.20.0-slim
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
# Production dependencies only (no PGlite, drizzle-kit or test tooling).
RUN pnpm install --frozen-lockfile --prod --filter "@skein/api..." && chown -R node:node /app
USER node
WORKDIR /app/apps/api
EXPOSE 8080
# node is PID 1, so Railway's SIGTERM reaches the shutdown handler (src/server.ts),
# which drains running verdicts before exit. tsx is loaded as an import hook.
CMD ["node", "--import", "tsx", "src/server.ts"]
