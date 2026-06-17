# Multi-stage Dockerfile for Ribix IDE Web
# Supports both development and production builds

FROM node:20.18.2-alpine AS base

# Install dependencies for native modules
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    git

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Development stage
FROM base AS development
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "run", "dev"]

# Production build stage
FROM base AS builder
COPY . .
RUN npm run build

# Production stage
FROM node:20.18.2-alpine AS production

WORKDIR /app

# Copy the built app and the toolchain needed for `vite preview`.
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/vite.config.ts ./vite.config.ts

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S ribix -u 1001

# Change ownership
RUN chown -R ribix:nodejs /app
USER ribix

EXPOSE 3000
ENV NODE_ENV=production

CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "3000"]
