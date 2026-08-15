FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates gosu \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json bun.lock ./
RUN npm install --omit=dev && npm cache clean --force
COPY server.mjs ./
COPY public ./public
COPY docker-entrypoint.sh /usr/local/bin/teledumb-entrypoint

RUN mkdir -p /data/app /data/telegram /data/media \
    && chown -R node:node /data /app \
    && chmod 0755 /usr/local/bin/teledumb-entrypoint

ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["teledumb-entrypoint"]
CMD ["node", "server.mjs"]
