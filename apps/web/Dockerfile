# Skein web. Build context: the repository root.
# docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_SKEIN_API=https://api.example .
FROM node:22.20.0-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
# The workspace libraries the site imports (@skein/ui, and @skein/engine for /verify) must be present to install and build.
COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile --filter "@skein/web..."
# Inlined into the client bundle at build time: required, so an image never
# silently points its visitors at localhost.
ARG NEXT_PUBLIC_SKEIN_API
RUN test -n "$NEXT_PUBLIC_SKEIN_API" || (echo "build with --build-arg NEXT_PUBLIC_SKEIN_API=<API origin>" >&2; exit 1)
ENV NEXT_PUBLIC_SKEIN_API=$NEXT_PUBLIC_SKEIN_API NEXT_TELEMETRY_DISABLED=1 BUILD_STANDALONE=1
RUN pnpm --filter @skein/web build

FROM node:22.20.0-slim
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
