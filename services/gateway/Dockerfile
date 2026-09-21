# Build from the monorepo root:  docker build -f services/gateway/Dockerfile -t airiel-gateway .
FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@12.5.1 --activate
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages/protocol/package.json packages/protocol/
COPY services/gateway/package.json services/gateway/
RUN pnpm install --frozen-lockfile --filter @airiel/gateway...
COPY packages/protocol packages/protocol
COPY services/gateway services/gateway
RUN pnpm --filter @airiel/protocol build && pnpm --filter @airiel/gateway build
RUN pnpm --filter @airiel/gateway deploy --prod /out

FROM node:22-alpine
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=build /out .
USER node
EXPOSE 8080
HEALTHCHECK CMD wget -qO- http://localhost:8080/healthz || exit 1
CMD ["node", "dist/index.js"]
