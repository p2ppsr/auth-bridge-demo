# Backend Dockerfile for auth-bridge-example
# Build context: repo root (auth-bridge-example/)

FROM node:20-slim AS builder
WORKDIR /build

# Copy bundled packages so file:../packages/* resolves
COPY packages /build/packages

# Build auth-bridge-express (ESM/CJS dual package)
WORKDIR /build/packages/auth-bridge-express
RUN npm install --ignore-scripts
RUN npm run build

# Build backend
WORKDIR /build/backend
COPY backend/package.json ./
COPY backend/tsconfig.json ./
COPY backend/src ./src

RUN npm install --ignore-scripts

# ── Runtime stage ─────────────────────────────────────────────────
FROM node:20-slim AS runtime
WORKDIR /app

COPY --from=builder /build/packages /app/packages
COPY --from=builder /build/backend /app/backend

WORKDIR /app/backend

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["npx", "tsx", "src/server.ts"]
