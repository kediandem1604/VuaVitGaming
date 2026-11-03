# syntax=docker/dockerfile:1
#
# GGD Hub — ảnh Docker nhiều tầng cho Railway (hoặc bất kỳ máy chủ Docker nào).
#
#   Tầng build : cài đủ dependency (kể cả dev), biên dịch server (tsc) và web (vite).
#   Tầng chạy  : chỉ dependency production + dist/ + prisma/ (schema + migration),
#                chạy bằng user `node` (không phải root).
#
# `npm start` = prisma migrate deploy → nạp dữ liệu tham chiếu → node dist/server/main.js
# nên mỗi lần deploy tự áp dụng migration mới rồi mới mở cổng.
#
# Prisma cần libssl trên ảnh *-slim (engine Debian openssl-3.x) → cài openssl +
# ca-certificates ở cả hai tầng. ca-certificates còn để nối TLS tới Neon, Discord, Gmail.

ARG NODE_IMAGE=node:24-slim

# ---------------------------------------------------------------------------
# Tầng build
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS build

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Cài dependency trước khi copy mã nguồn để tận dụng cache của Docker.
COPY package.json package-lock.json ./
RUN npm ci

# Phần còn lại của repo (xem .dockerignore: không có node_modules, dist, .env, test…).
COPY . .

# prisma generate + tsc (server) + vite build (web) → dist/server, dist/web
RUN npm run build

# ---------------------------------------------------------------------------
# Tầng chạy
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3000
# Prisma CLI không in nhắc cập nhật / không gọi về nhà khi migrate lúc khởi động.
ENV PRISMA_HIDE_UPDATE_MESSAGE=1
ENV CHECKPOINT_DISABLE=1
# Tắt thông báo "new version of npm" khi `npm start`.
ENV NPM_CONFIG_UPDATE_NOTIFIER=false

# Chạy mọi bước còn lại bằng user `node` (có sẵn trong ảnh node): node_modules, Prisma
# Client sinh ra và cache npm/Prisma (/home/node) đều thuộc node ngay từ đầu — không cần
# `chown -R` sau cùng (lệnh đó sẽ nhân đôi node_modules vào một layer mới).
RUN mkdir -p /app && chown node:node /app
USER node
WORKDIR /app

# Chỉ dependency production (prisma CLI nằm trong dependencies để `migrate deploy` chạy được).
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev

# Schema + migration (cho `prisma migrate deploy`) rồi sinh lại Prisma Client đúng schema.
COPY --chown=node:node prisma ./prisma
RUN npx prisma generate

# Mã đã biên dịch: dist/server (API + bot + seed) và dist/web (file tĩnh Fastify phục vụ).
COPY --chown=node:node --from=build /app/dist ./dist

EXPOSE 3000

# Railway dùng "Healthcheck Path" riêng (/healthz); HEALTHCHECK này cho docker/compose chạy tay.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["npm", "start"]
