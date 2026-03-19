FROM oven/bun:1 AS base
WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

COPY src/ src/

ENV PORT=3000
EXPOSE 3000

CMD ["bun", "run", "src/index.ts"]
