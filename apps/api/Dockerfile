# Production image (T21). Multi-stage; final = node:22-alpine (arm64-safe runtime for
# better-sqlite3@13, which segfaults on node:20.20.2 — see T4.5 session notes).
# The bundled server (dist/server.js, esbuild minified) ships with better-sqlite3 + sharp
# kept external, so only those two native packages' runtime files are copied.

FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# pnpm via corepack (packageManager pins the version); python/make/g++ needed because
# better-sqlite3 has no musl prebuilt and compiles from source
RUN apk add --no-cache python3 make g++ \
    && corepack enable

# Install workspace deps with the lockfile
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

# Build the whole workspace (shared → api bundle → web static)
COPY tsconfig.base.json biome.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/web apps/web
RUN pnpm --filter @grocery/shared build \
    && pnpm --filter api build \
    && pnpm --filter web build

# Self-contained runtime node_modules for the bundle's two native externals
# (better-sqlite3, sharp): copy their pnpm store slices with symlinks DEREFERENCED.
# The slices' internal @img/* entries are relative symlinks into sibling store dirs
# (e.g. ../../@img+colour@1.1.0/...) that don't exist in the runtime stage — a plain
# copy leaves them dangling and image upload fails with ERR_MODULE_NOT_FOUND.
RUN mkdir -p /out/node_modules \
    && cp -rL /app/node_modules/.pnpm/sharp@*/node_modules/. /out/node_modules/ \
    && cp -rL /app/node_modules/.pnpm/better-sqlite3@*/node_modules/. /out/node_modules/ \
    && rm -rf /out/node_modules/@types

# ---------------------------------------------------------------- final: api
FROM node:22-alpine AS api
WORKDIR /app
ENV NODE_ENV=production \
    DATABASE_PATH=/data/grocery.db \
    UPLOADS_PATH=/data/images \
    HOST=0.0.0.0 \
    PORT=3000

COPY --from=build /app/apps/api/dist/server.js ./dist/server.js
# The bundled migrate.ts resolves the migrations folder relative to dist/ → /drizzle
# (dist/../..), per the T4.5 session note — hence the root-level copy.
COPY --from=build /app/apps/api/drizzle /drizzle
# Runtime files for the two native externals of the bundle (better-sqlite3, sharp):
# flat, symlink-free node_modules prepared in the build stage (see the /out step above).
COPY --from=build /out/node_modules ./node_modules/
RUN mkdir -p /data /data/images \
    && addgroup -S app && adduser -S app -G app \
    && chown -R app:app /data /app
USER app

EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --retries=5 --start-period=5s \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["node", "dist/server.js"]
