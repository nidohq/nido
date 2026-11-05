# Build Caddy WITH the rate-limit plugin (not in the stock apk `caddy`): the
# per-IP token bucket in Caddyfile needs github.com/mholt/caddy-ratelimit
# compiled in. The output is a static Go binary (CGO off), so it runs on the
# Wolfi-glibc relayer base below regardless of the builder's libc.
# Pin both the builder base and the plugin version so this budget-gating proxy is
# reproducible (was `caddy:2-builder` + an unversioned plugin — every rebuild
# re-resolved whatever was latest). caddy-ratelimit is pre-1.0; v0.1.0 is its only
# release, i.e. exactly what the unversioned build already resolved to. The
# `caddy validate` step below fail-closes if a pinned bump ever breaks the config.
FROM docker.io/library/caddy:2.11.4-builder AS caddybuild
RUN xcaddy build --with github.com/mholt/caddy-ratelimit@v0.1.0

FROM docker.io/openzeppelin/openzeppelin-relayer:v1.9.0

# Which config/*.json gets baked in as /app/config/config.json — config.json
# (testnet, the default) or config.mainnet.json. fly.toml doesn't set this
# (relying on the default keeps testnet's build untouched);
# fly.mainnet.toml's [build.args] sets it to config.mainnet.json. Needed
# because config.json only seeds Redis on a relayer's very first boot
# (README.md's "Changing Relayers/Signers After Initial Bootstrap") — if
# both fly.toml and fly.mainnet.toml baked in the SAME file, whichever
# environment booted for the first time more recently would decide what the
# OTHER one's disaster-recovery reference says, with no way to tell from the
# file alone which network's values it actually holds.
ARG CONFIG_FILE=config.json

USER root
COPY --from=caddybuild /usr/bin/caddy /usr/bin/caddy

# Since v1.6.0 the base image has /app/plugins/pnpm-workspace.yaml, so a plain
# `pnpm install` here resolves to /app/plugins as the workspace root and aborts
# (ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY). --ignore-workspace keeps each
# plugin a standalone project and leaves the image's own node_modules alone.
COPY plugins/channels /app/plugins/channels
RUN cd /app/plugins/channels && pnpm install --prod --frozen-lockfile --ignore-workspace \
    && chown -R nonroot /app/plugins/channels

COPY plugins/funder /app/plugins/funder
RUN cd /app/plugins/funder && pnpm install --prod --frozen-lockfile --ignore-workspace \
    && chown -R nonroot /app/plugins/funder

COPY --chown=nonroot config/${CONFIG_FILE} /app/config/config.json
COPY --chown=nonroot config/networks /app/config/networks
COPY --chown=nonroot Caddyfile /app/Caddyfile
RUN API_KEY=placeholder caddy validate --config /app/Caddyfile --adapter caddyfile
COPY --chown=nonroot entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

USER nonroot
ENV IN_DOCKER=true
ENTRYPOINT ["/app/entrypoint.sh"]
