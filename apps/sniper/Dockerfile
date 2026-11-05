# Skein Sniper. Build context: the repository root.
FROM node:22.20.0-slim
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/sniper ./apps/sniper
RUN pnpm install --frozen-lockfile --prod --filter "@skein/sniper..." && chown -R node:node /app
USER node
WORKDIR /app/apps/sniper
EXPOSE 8080
CMD ["node", "--import", "tsx", "src/main.ts"]
