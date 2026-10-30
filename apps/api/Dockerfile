# Skein API. Build context: the repository root.
FROM node:22.20.0-slim
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile --filter "@skein/api..."
ENV NODE_ENV=production
EXPOSE 8080
CMD ["pnpm", "--filter", "@skein/api", "start"]
