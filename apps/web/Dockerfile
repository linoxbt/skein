# Skein web. Build context: the repository root.
FROM node:22.20.0-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile --filter "@skein/web..."
# Inlined into the client bundle at build time.
ARG NEXT_PUBLIC_SKEIN_API
ENV NEXT_PUBLIC_SKEIN_API=$NEXT_PUBLIC_SKEIN_API NEXT_TELEMETRY_DISABLED=1 BUILD_STANDALONE=1
RUN pnpm --filter @skein/web build

FROM node:22.20.0-slim
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
