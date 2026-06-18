#!/bin/sh
set -e

# Apply pending migrations. Invoke the Prisma CLI entrypoint directly rather
# than the `.bin/prisma` shim: Docker's COPY dereferences that symlink into a
# plain file under node_modules/.bin, which breaks the CLI's relative lookup of
# its bundled *.wasm files. Prisma reads DATABASE_URL from .env via
# `import "dotenv/config"` in prisma.config.ts.
node node_modules/prisma/build/index.js migrate deploy

# Start the Next.js standalone server. `-r dotenv/config` preloads .env so
# DATABASE_URL / JWT_SECRET are available to the runtime (lib/prisma.ts adapter).
exec node -r dotenv/config server.js
