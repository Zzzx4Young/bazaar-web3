# syntax=docker/dockerfile:1
FROM node:22.23.1-bookworm-slim AS base
WORKDIR /app
RUN chown node:node /app

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
ARG BACKEND_ORIGIN=http://api:3001
ENV BACKEND_ORIGIN=$BACKEND_ORIGIN
COPY . .
RUN npm run build

FROM base AS runtime-dependencies
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM base AS runtime
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
USER node
COPY --from=runtime-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/next.config.mjs ./next.config.mjs
COPY --from=build --chown=node:node /app/messages ./messages
COPY --from=build --chown=node:node /app/src/i18n ./src/i18n
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start"]
