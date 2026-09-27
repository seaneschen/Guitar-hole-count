FROM node:22-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --prod
COPY server ./server
COPY web ./web
ENV PORT=8787
ENV DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 8787
CMD ["pnpm", "start"]
