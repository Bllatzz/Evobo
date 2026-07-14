# Build context is the repo root (npm workspaces) — see fly.toml's `dockerfile`
# path pointing here with build context "..".
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/design-tokens/package.json packages/design-tokens/package.json
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY tsconfig.base.json ./
COPY apps/api apps/api
COPY packages/shared-types packages/shared-types
COPY packages/design-tokens packages/design-tokens
RUN npx prisma generate --schema apps/api/prisma/schema.prisma
RUN npm run build --workspace=apps/api

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
COPY --from=build /app/packages packages

EXPOSE 3000
CMD ["node", "apps/api/dist/server.js"]
