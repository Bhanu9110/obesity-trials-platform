FROM node:22-bookworm-slim
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

# Default: run the daily scheduler (backfill-if-empty, then cron at midnight).
# Override the command for one-off runs, e.g. `npm run backfill` or `npm run sync`.
CMD ["npm", "run", "scheduler"]
