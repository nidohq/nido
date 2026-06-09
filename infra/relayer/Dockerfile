FROM docker.io/openzeppelin/openzeppelin-relayer:v1.5.0

USER root
RUN apk add --no-cache caddy

COPY plugins/channels /app/plugins/channels
RUN cd /app/plugins/channels && pnpm install --prod --no-frozen-lockfile \
    && mkdir -p /app/config/keys \
    && chown -R nonroot /app/plugins/channels /app/config

COPY config/config.json /app/config/config.json
COPY config/networks /app/config/networks
COPY Caddyfile /app/Caddyfile
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh && chown -R nonroot /app/config

USER nonroot
ENV IN_DOCKER=true
ENTRYPOINT ["/app/entrypoint.sh"]
