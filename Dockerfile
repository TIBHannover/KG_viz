# syntax=docker/dockerfile:1

# ---- builder ---------------------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /app

# SPARQL endpoint baked into the production bundle at build time — Vite
# inlines import.meta.env.* into the JS, so these must be real values here,
# not left as the placeholders in src/config.js. Override at build time:
#   docker build --build-arg VITE_SPARQL_ENDPOINT=https://... \
#                 --build-arg VITE_SPARQL_GRAPH=urn:... .
ARG VITE_SPARQL_ENDPOINT
ARG VITE_SPARQL_GRAPH
ENV VITE_SPARQL_ENDPOINT=${VITE_SPARQL_ENDPOINT}
ENV VITE_SPARQL_GRAPH=${VITE_SPARQL_GRAPH}

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- runtime ----------------------------------------------------------------
FROM nginx:alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

# public/kg-data.json and public/kg-keywords.json are deliberately NOT part
# of this image (see .dockerignore) — they're bind-mounted in at runtime by
# docker-compose.yml so a data refresh never requires an image rebuild.

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
