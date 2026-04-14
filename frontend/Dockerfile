# Frontend Dockerfile for auth-bridge-example
# Build context: repo root (auth-bridge-example/)

FROM node:20-slim AS builder
WORKDIR /build

# Copy bundled packages
COPY packages /build/packages

# Build auth-bridge-react
WORKDIR /build/packages/auth-bridge-react
RUN npm install --ignore-scripts
RUN npm run build

# Build frontend
WORKDIR /build/frontend
COPY frontend/package.json ./
COPY frontend/tsconfig.json ./
COPY frontend/vite.config.ts ./
COPY frontend/index.html ./
COPY frontend/src ./src

RUN npm install --ignore-scripts

# Build-time env vars (Vite bakes these into the bundle)
ARG VITE_GOOGLE_CLIENT_ID=""
ENV VITE_GOOGLE_CLIENT_ID=${VITE_GOOGLE_CLIENT_ID}

RUN npm run build

# ── Runtime stage ─────────────────────────────────────────────────
FROM nginx:alpine AS runtime

COPY --from=builder /build/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf.template /etc/nginx/templates/default.conf.template

ENV PORT=8080
EXPOSE 8080

CMD ["/bin/sh", "-c", "envsubst '$PORT $BACKEND_URL' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
