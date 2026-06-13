FROM node:20-bookworm-slim AS deps

WORKDIR /app

COPY package*.json ./
RUN npm ci

FROM deps AS builder

ARG API_BASE_URL=http://localhost:8080/api
ARG WEBSOCKET_URL=ws://localhost:8080

ENV API_BASE_URL=${API_BASE_URL}
ENV WEBSOCKET_URL=${WEBSOCKET_URL}

COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/next.config.js ./next.config.js

EXPOSE 3000

CMD ["npm", "run", "start"]
