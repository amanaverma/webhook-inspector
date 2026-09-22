# syntax=docker/dockerfile:1

FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json
RUN npm ci
COPY apps/web apps/web
# Rewrites are resolved when the app is built, so the API address is baked into
# the image rather than read at startup.
ARG API_BASE_URL=http://localhost:3000
ENV API_BASE_URL=$API_BASE_URL
RUN npm run build -w @wi/web

FROM node:20-slim
ENV NODE_ENV=production
ENV PORT=3001
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3001
CMD ["node", "apps/web/server.js"]
