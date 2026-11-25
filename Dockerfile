# syntax=docker/dockerfile:1
# One image for the api, the worker and migrations (different commands, see docker-compose.prod.yml).
# Built for linux/arm64 in CI. Everything is bundled by esbuild (scripts/bundle-node.mjs), so the
# runtime stage has no node_modules.

FROM node:26.13.1-slim AS build
WORKDIR /repo
RUN npm install -g pnpm@12.23.0
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc* ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts \
      --filter flolist --filter "@flolist/api..." --filter "@flolist/worker..."
COPY scripts scripts
COPY apps/api apps/api
COPY apps/worker apps/worker
COPY packages/db packages/db
COPY packages/shared packages/shared
RUN pnpm --filter @flolist/api --filter @flolist/worker build

FROM node:26.13.1-slim AS runtime
ENV NODE_ENV=production NODE_OPTIONS=--enable-source-maps
WORKDIR /app
COPY --from=build /repo/apps/api/dist dist
COPY --from=build /repo/apps/worker/dist dist
# @flolist/db resolves `../migrations` relative to dist/migrate.js.
COPY --from=build /repo/packages/db/migrations migrations
USER node
EXPOSE 3000
CMD ["node", "dist/api.js"]
