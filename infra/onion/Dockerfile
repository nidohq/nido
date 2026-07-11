# nido onion service: tor (single-onion mode, PoW defenses) + Caddy vhost
# router in one image. Debian's tor is built with --enable-gpl, which the
# proof-of-work intro defense requires.
FROM caddy:2 AS caddy

FROM debian:trixie-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends tor ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && tor --version

COPY --from=caddy /usr/bin/caddy /usr/bin/caddy

COPY torrc /etc/tor/torrc-onion
COPY Caddyfile /etc/caddy/Caddyfile
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Frontend onion build, staged into this directory before `fly deploy`
# (see README). Kept last so config edits don't bust the layer cache above.
COPY dist /srv/dist

ENTRYPOINT ["/entrypoint.sh"]
