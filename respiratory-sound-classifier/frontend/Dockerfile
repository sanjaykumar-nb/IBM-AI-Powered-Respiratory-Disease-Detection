# Stage 1: build the React app with Vite.
# Debian-based (glibc) on purpose: Vite's bundler ships native s390x binaries for glibc only,
# so an Alpine (musl) build stage would fail on IBM Z / LinuxONE. (node:22-slim has no s390x image;
# the trixie variant does.)
FROM node:22-trixie-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html vite.config.js ./
COPY public ./public
COPY src ./src
RUN npm run build

# Stage 2: serve the static build with nginx and proxy /api to the backend
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
