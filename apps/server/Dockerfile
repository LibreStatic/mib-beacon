FROM node:22.17.0-bookworm-slim AS build

WORKDIR /workspace

RUN npm install --global pnpm@10.33.2

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY packages/app/package.json packages/app/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/resolver/package.json packages/resolver/package.json
COPY packages/smi/package.json packages/smi/package.json
COPY packages/transport/package.json packages/transport/package.json
COPY packages/ui/package.json packages/ui/package.json

RUN pnpm install --frozen-lockfile

COPY apps/server apps/server
COPY packages packages

RUN pnpm --filter @mibbeacon/server build

FROM node:22.17.0-bookworm-slim AS runtime

ENV NODE_ENV=production \
    MIB_BEACON_SERVER_HOST=0.0.0.0 \
    MIB_BEACON_SERVER_PORT=8899 \
    MIB_BEACON_SERVER_DATA=/data

RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates iputils-ping traceroute \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build --chown=node:node /workspace/apps/server/dist ./dist

RUN mkdir /data && chown node:node /data

USER node

EXPOSE 8899/tcp
EXPOSE 1162/udp

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8899').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "dist/server.cjs"]
