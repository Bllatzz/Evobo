# Build context is the repo root (npm workspaces) — see fly.toml's `dockerfile`
# path pointing here with build context "..".
#
# Bundles apps/worker (Telegram listener + OCR queue) into the same image
# and process as apps/api — one Fly machine, one bill, since this is a
# single-user hobby deployment where a listener hiccup taking the API down
# with it (or vice versa) is an acceptable trade for not running a second
# always-on machine. See server.ts for how it's started conditionally.
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/design-tokens/package.json packages/design-tokens/package.json
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY tsconfig.base.json ./
COPY apps/api apps/api
COPY apps/worker apps/worker
COPY packages/shared-types packages/shared-types
COPY packages/design-tokens packages/design-tokens
RUN npx prisma generate --schema apps/api/prisma/schema.prisma
RUN npm run build --workspace=apps/api
RUN npm run build --workspace=apps/worker

# Node 24 runs the workspace packages' raw .ts (no build step for those) via
# native type-stripping, so apps/api/dist/server.js can import
# @evobo/shared-types and @evobo/design-tokens directly at runtime.
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/prisma apps/api/prisma
COPY --from=build /app/apps/worker/package.json apps/worker/package.json
COPY --from=build /app/apps/worker/dist apps/worker/dist
COPY --from=build /app/packages packages

EXPOSE 3000
CMD ["node", "apps/api/dist/server.js"]
