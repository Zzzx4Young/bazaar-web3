# syntax=docker/dockerfile:1
FROM node:22.23.1-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS base
RUN apt-get update \
  && apt-get install --yes --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN chown node:node /app
USER node

FROM base AS build
ENV PRISMA_HIDE_UPDATE_MESSAGE=1
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci
COPY --chown=node:node prisma.config.ts tsconfig.json tsconfig.build.json ./
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node src ./src
RUN npm run build && npm cache clean --force

FROM base AS runtime-dependencies
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional && npm cache clean --force

FROM base AS runtime
ARG VCS_REF=unknown
LABEL org.opencontainers.image.source="https://github.com/Zzzx4Young/bazaar-web3" \
  org.opencontainers.image.revision="$VCS_REF"
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001
COPY --chown=node:node package.json ./
COPY --chown=node:node --from=runtime-dependencies /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/api/health/ready`,{method:'POST',headers:{origin:process.env.APP_ORIGIN,'content-type':'application/json'},body:'{}'}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/main.js"]

FROM build AS migrate
ARG VCS_REF=unknown
LABEL org.opencontainers.image.source="https://github.com/Zzzx4Young/bazaar-web3" \
  org.opencontainers.image.revision="$VCS_REF"
ENV NODE_ENV=production
CMD ["node", "scripts/deploy-migrations.mjs"]
