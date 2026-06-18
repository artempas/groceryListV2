# Stage 1: deps
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Stage: migrator — self-contained Prisma CLI install used to run migrations at
# startup. Installed in isolation so the *entire* CLI dependency tree is present
# (prisma -> @prisma/config -> effect -> fast-check -> pure-rand, @prisma/dev ->
# pathe, ...). Selectively copying individual packages from the build is
# unreliable: these transitive deps live at the node_modules root and are easy
# to miss. dotenv is included because prisma.config.ts does `import "dotenv/config"`.
FROM node:22-alpine AS migrator
WORKDIR /migrate
RUN npm install --no-audit --no-fund prisma@^7.8.0 dotenv@^17.4.2

# Stage 2: builder
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate
RUN npm run build

# Stage 3: runner
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Tooling needed to run `prisma migrate deploy` at startup. The standalone
# output only traces runtime deps, so the complete Prisma CLI tree (from the
# `migrator` stage) is merged into node_modules. Shared packages (@prisma/*,
# dotenv) resolve to the same versions as the app, so the merge is conflict-free.
COPY --from=migrator --chown=nextjs:nodejs /migrate/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --chown=nextjs:nodejs entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["./entrypoint.sh"]
