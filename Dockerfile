FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends gosu ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json db.mjs server.mjs ./
COPY public ./public
COPY scripts ./scripts
RUN mkdir -p /app/data && chown -R node:node /app && chmod +x /app/scripts/entrypoint.sh
EXPOSE 3077
ENTRYPOINT ["/app/scripts/entrypoint.sh"]
CMD ["node", "server.mjs"]
