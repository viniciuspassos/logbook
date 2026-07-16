# syntax=docker/dockerfile:1

# Multi-stage build for logbook-server (NestJS + TypeScript).
# Stage 1 compiles TypeScript with full devDependencies; stage 2 ships only
# the compiled dist/ + production node_modules on a slim runtime image, run
# as a non-root user. This image is local-dev/Compose only (see
# docker-compose.yml at the repo root) — there is no hosted deployment target
# for it yet.

FROM node:20.18-bookworm-slim AS build
WORKDIR /app

# Install dependencies first (incl. dev deps needed to compile) so this layer
# is cached independently of source changes.
COPY package.json package-lock.json ./
RUN npm ci

# Now copy the rest of the server source and compile.
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# Prune devDependencies out of node_modules in place, reusing the same layer
# rather than a separate `npm ci --omit=dev` pass in the runtime stage (keeps
# the lockfile-resolved versions identical between build and runtime).
RUN npm prune --omit=dev

FROM node:20.18-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Run as a non-root user rather than the image's default root.
RUN groupadd --gid 1001 nodeapp \
  && useradd --uid 1001 --gid nodeapp --shell /usr/sbin/nologin --create-home nodeapp

COPY --chown=nodeapp:nodeapp package.json ./
COPY --from=build --chown=nodeapp:nodeapp /app/node_modules ./node_modules
COPY --from=build --chown=nodeapp:nodeapp /app/dist ./dist

# UPLOAD_DIR default from .env.example — created up front so it exists (and
# is owned by nodeapp) even before a volume is mounted over it.
RUN mkdir -p /app/uploads && chown nodeapp:nodeapp /app/uploads

USER nodeapp

EXPOSE 3000

CMD ["node", "dist/main.js"]
