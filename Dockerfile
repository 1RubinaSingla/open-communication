# Orchestrator image for Railway/Render/Fly.
# Builds only the orchestrator + its workspace deps (protocol/db/credits) —
# not the Next.js web app or the worker.
FROM node:22-bookworm-slim

# better-sqlite3 compiles a native addon → needs a toolchain.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

# Copy the whole workspace (node_modules is excluded via .dockerignore).
COPY . .

# Install the orchestrator subtree WITH devDeps — the server runs via tsx at
# runtime (no build step), and tsx lives in devDependencies.
RUN pnpm install --filter @0c/orchestrator... --prod=false

# Persistent SQLite lives on a mounted volume (see DEPLOY.md). PORT is injected.
ENV DB_PATH=/data/0c.sqlite
EXPOSE 4100
CMD ["pnpm", "--filter", "@0c/orchestrator", "start"]
