# 公共基础层：证书用于 HTTPS，OpenSSL 满足 Prisma 运行依赖；固定 pnpm 版本保持安装一致。
FROM node:24-bookworm-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@12.16.1
ENV NEXT_TELEMETRY_DISABLED=1

# 先复制依赖清单以复用安装缓存，锁文件不匹配时直接失败。
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN pnpm install --frozen-lockfile

# 编译 Next 与 Prisma 客户端；实际数据库及外部服务凭据在运行时注入。
FROM deps AS builder
COPY . .
RUN pnpm build

# 移除开发依赖，保留同一镜像执行迁移所需的生产依赖。
FROM builder AS production-deps
RUN pnpm prune --prod --ignore-scripts

# 最终镜像仅复制运行产物，并使用非 root 用户监听容器全部网卡的 3000 端口。
FROM base AS runner
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 TZ=Asia/Shanghai
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs
# Prisma CLI 是生产依赖，迁移任务可以复用应用镜像，无需另外构建工具镜像。
COPY --from=production-deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma.config.ts ./prisma.config.ts
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
