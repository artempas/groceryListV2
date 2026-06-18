#!/bin/sh
set -e

# Apply pending migrations. Prisma CLI reads DATABASE_URL from .env via
# `import "dotenv/config"` in prisma.config.ts.
npx prisma migrate deploy

# Start the Next.js standalone server. `-r dotenv/config` preloads .env so
# DATABASE_URL / JWT_SECRET are available to the runtime (lib/prisma.ts adapter).
exec node -r dotenv/config server.js
