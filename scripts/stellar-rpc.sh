#!/usr/bin/env bash
# Nido's one source of the Soroban RPC endpoint choice and its fallback list,
# sourced by every script that reads the chain (scripts/perch-infra.sh,
# scripts/deploy-factory.sh). Same interface and variables as Perch's
# scripts/stellar-rpc.sh: when vendor/perch carries that helper, it is sourced
# and nothing below runs, so the two never disagree. Until the submodule is
# re-pinned to a Perch commit that has it, the copy below runs: Perch's helper
# as of 653fa7d (bitswell-hq/stellar-registry__perch#39), unchanged below the
# divider. Delete the copy once the pin carries the helper.
#
# Variables (docs/RUNBOOKS.md "RPC endpoints"):
#   RPC_URL, else STELLAR_RPC_URL   override, used as given, never fallen back from
#   PERCH_RPC_FALLBACKS             ordered, space-separated; unset = testnet's
#                                   Gateway.fm, none on mainnet; empty = none
#   PERCH_RPC_MAX_LAG               max ledgers a fallback may trail (default 10)
#   PERCH_HORIZON_URL               freshness reference (default per network)
#   PERCH_RPC_PROBE_ATTEMPTS, PERCH_RPC_CALL_ATTEMPTS, PERCH_RPC_TIMEOUT

_nido_perch_rpc="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/vendor/perch/scripts/stellar-rpc.sh"
if [ -f "$_nido_perch_rpc" ]; then
    # shellcheck source=/dev/null
    . "$_nido_perch_rpc"
    return 0
fi

# ---- Perch's scripts/stellar-rpc.sh @ 653fa7d ------------------------------
# Choose the Soroban RPC endpoint a script reads the chain through, with a
# guarded fallback for when the manifest's endpoint is down. Sourced, not run:
#
#   . "$repo_root/scripts/stellar-rpc.sh"
#   rpc_select "$(jq -r .rpc_url "$manifest")" "$(jq -r .network_passphrase "$manifest")"
#   rpc_stellar contract info hash --id C...      # stellar <words> --rpc-url <chosen> ...
#
# The endpoint, in order:
#
#   1. RPC_URL, else STELLAR_RPC_URL: an explicit override. Used as given:
#      never probed, never fallen back from.
#   2. The primary (rpc_select's first argument, normally the manifest's
#      rpc_url), if it answers getNetwork with the expected passphrase and
#      getLatestLedger (PERCH_RPC_PROBE_ATTEMPTS tries, default 3).
#   3. Only if the primary is DOWN (no connection, a timeout, or an HTTP 5xx),
#      the first fallback that passes every guard:
#        - getNetwork answers the expected network passphrase, and
#        - its getLatestLedger is at most PERCH_RPC_MAX_LAG ledgers (default
#          10, ~50s) behind the newest ledger another source reports: another
#          candidate on the same network, or Horizon (PERCH_HORIZON_URL,
#          default horizon-testnet / horizon for testnet / pubnet; empty to
#          disable). With no other source to compare against, a fallback is
#          refused: its freshness cannot be confirmed.
#      A primary that answers but is unhealthy otherwise (a 4xx, the wrong
#      network, no ledger) is a misconfiguration and is reported, not routed
#      around.
#
# Fallbacks: PERCH_RPC_FALLBACKS, space-separated and in order (set it empty to
# disable). Unset, testnet falls back to Gateway.fm's public endpoint and every
# other network, mainnet included, has none.
#
# A chain call that fails mid-run (rpc_stellar, rpc_json) moves the run to
# the next guarded fallback only when the endpoint failed it: the call's own
# error is server-side (an HTTP 5xx, a JSON-RPC InternalError, no response;
# retried PERCH_RPC_CALL_ATTEMPTS times in all, default 3, before moving), or
# a fresh probe finds the endpoint down. A call that failed against a healthy
# endpoint (a contract error, a missing entry) fails as it is. Checks on what
# was read, such as a fetched wasm's hash, never trigger a fallback. Once
# moved, the rest of the run stays on the new endpoint, including reads made
# in subshells.
#
# Every call logs the endpoint that served it to stderr ("rpc: ...").
#
# Requires curl and jq. rpc_select sets an EXIT trap to remove its state file.

# The default fallbacks, the one place they are listed, keyed by network.
rpc_default_fallbacks() { # passphrase
    case "$1" in
        "Test SDF Network ; September 2015") echo "https://soroban-rpc.testnet.stellar.gateway.fm" ;;
        *) ;;
    esac
}

rpc_default_horizon() { # passphrase
    case "$1" in
        "Test SDF Network ; September 2015") echo "https://horizon-testnet.stellar.org" ;;
        "Public Global Stellar Network ; September 2015") echo "https://horizon.stellar.org" ;;
        *) ;;
    esac
}

# Logs go to the stderr of the sourcing shell, also from inside a caller's
# `2>file` capture.
exec 9>&2
_rpc_log() { printf 'rpc: %s\n' "$*" >&9; }

_rpc_pass=""
_rpc_server_error=false
_rpc_override=""
_rpc_candidates=""
_rpc_state=""

# POST one JSON-RPC call. Sets _rpc_code (000 when the transport failed) and
# _rpc_body.
_rpc_post() { # url method
    local out
    out="$(mktemp)"
    _rpc_code="$(curl -sS -m "${PERCH_RPC_TIMEOUT:-10}" -o "$out" -w '%{http_code}' "$1" \
        -H 'content-type: application/json' \
        -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$2\"}" 2>/dev/null)" || _rpc_code=000
    [ -n "$_rpc_code" ] || _rpc_code=000
    _rpc_body="$(cat "$out")"
    rm -f "$out"
}

# Probe an endpoint. Sets _rpc_ledger and returns 0 when it is healthy; else
# sets _rpc_why and _rpc_kind: `down` (transport or 5xx) or `bad`.
_rpc_probe() { # url
    local pass
    _rpc_ledger=""
    _rpc_post "$1" getNetwork
    case "$_rpc_code" in
        000) _rpc_kind=down _rpc_why="no response"; return 1 ;;
        5*) _rpc_kind=down _rpc_why="HTTP $_rpc_code"; return 1 ;;
        200) ;;
        *) _rpc_kind=bad _rpc_why="HTTP $_rpc_code"; return 1 ;;
    esac
    pass="$(jq -r '.result.passphrase // empty' <<<"$_rpc_body" 2>/dev/null)"
    [ "$pass" = "$_rpc_pass" ] || {
        _rpc_kind=bad _rpc_why="wrong network: passphrase '${pass:-none}', want '$_rpc_pass'"
        return 1
    }
    _rpc_post "$1" getLatestLedger
    case "$_rpc_code" in
        000) _rpc_kind=down _rpc_why="no response"; return 1 ;;
        5*) _rpc_kind=down _rpc_why="HTTP $_rpc_code"; return 1 ;;
        200) ;;
        *) _rpc_kind=bad _rpc_why="HTTP $_rpc_code"; return 1 ;;
    esac
    _rpc_ledger="$(jq -r '.result.sequence // empty' <<<"$_rpc_body" 2>/dev/null)"
    [[ "$_rpc_ledger" =~ ^[0-9]+$ ]] || { _rpc_kind=bad _rpc_why="no ledger in getLatestLedger"; return 1; }
}

# The probe, retried with a short backoff while the endpoint is down.
_rpc_probe_retry() { # url
    local try=1 attempts="${PERCH_RPC_PROBE_ATTEMPTS:-3}" delay=1
    until _rpc_probe "$1"; do
        [ "$_rpc_kind" = down ] && [ "$try" -lt "$attempts" ] || return 1
        sleep "$delay"
        try=$((try + 1)) delay=$((delay * 2))
    done
}

# The newest ledger any source other than $1 reports for this network: the
# other candidates, and Horizon. Empty when none answers.
_rpc_reference() { # url-to-exclude
    local u best="" h body seq pass
    for u in $_rpc_candidates; do
        [ "$u" != "$1" ] || continue
        _rpc_probe "$u" || continue
        [ -n "$best" ] && [ "$_rpc_ledger" -le "$best" ] || best="$_rpc_ledger"
    done
    h="${PERCH_HORIZON_URL-$(rpc_default_horizon "$_rpc_pass")}"
    if [ -n "$h" ] && body="$(curl -fsS -m "${PERCH_RPC_TIMEOUT:-10}" "${h%/}/" 2>/dev/null)"; then
        pass="$(jq -r '.network_passphrase // empty' <<<"$body" 2>/dev/null)"
        seq="$(jq -r '.history_latest_ledger // empty' <<<"$body" 2>/dev/null)"
        if [ "$pass" = "$_rpc_pass" ] && [[ "$seq" =~ ^[0-9]+$ ]]; then
            [ -n "$best" ] && [ "$seq" -le "$best" ] || best="$seq"
        fi
    fi
    printf '%s' "$best"
}

# A fallback is usable when it is on this network and not stale.
_rpc_guard() { # url
    local ledger ref lag="${PERCH_RPC_MAX_LAG:-10}"
    _rpc_probe "$1" || return 1
    ledger="$_rpc_ledger"
    ref="$(_rpc_reference "$1")"
    [ -n "$ref" ] || { _rpc_why="no other source answered to confirm it is current (ledger $ledger)"; return 1; }
    [ "$ledger" -ge $((ref - lag)) ] || {
        _rpc_why="stale: ledger $ledger, another source is at $ref (max lag $lag)"
        return 1
    }
    _rpc_why="ledger $ledger, reference $ref"
}

_rpc_use() { # url why
    printf '%s' "$1" >"$_rpc_state"
    _rpc_log "using $1 ($2)"
}

# Move to the first fallback after $1 that passes the guards.
_rpc_fall_back_from() { # url
    local u seen=false
    for u in $_rpc_candidates; do
        if ! $seen; then
            [ "$u" != "$1" ] || seen=true
            continue
        fi
        if _rpc_guard "$u"; then
            _rpc_use "$u" "fallback: $_rpc_why"
            return 0
        fi
        _rpc_log "refusing fallback $u: $_rpc_why"
    done
    _rpc_log "no usable fallback after $1"
    return 1
}

rpc_select() { # primary-url passphrase
    local primary="$1" fallbacks
    _rpc_pass="$2"
    _rpc_override="${RPC_URL:-${STELLAR_RPC_URL:-}}"
    _rpc_state="$(mktemp)"
    trap 'rm -f "$_rpc_state"' EXIT
    if [ -n "$_rpc_override" ]; then
        _rpc_candidates="$_rpc_override"
        _rpc_use "$_rpc_override" "RPC_URL/STELLAR_RPC_URL override; no fallback"
        return 0
    fi
    [ -n "$primary" ] && [ "$primary" != null ] || { _rpc_log "error: no primary RPC URL"; return 1; }
    if [ "${PERCH_RPC_FALLBACKS+set}" = set ]; then
        fallbacks="$PERCH_RPC_FALLBACKS"
    else
        fallbacks="$(rpc_default_fallbacks "$_rpc_pass")"
    fi
    _rpc_candidates="$primary $fallbacks"
    if _rpc_probe_retry "$primary"; then
        _rpc_use "$primary" "primary, ledger $_rpc_ledger"
        return 0
    fi
    if [ "$_rpc_kind" != down ]; then
        _rpc_log "error: primary $primary is unhealthy ($_rpc_why); not falling back"
        return 1
    fi
    _rpc_log "primary $primary is down ($_rpc_why)"
    _rpc_fall_back_from "$primary"
}

rpc_url() { cat "$_rpc_state"; }

# After a failed call: move on only if the endpoint failed it, by the call's
# own server-side error or a probe finding it down. Returns 1 (stay, and fail
# the call) when it is healthy, overridden, or no fallback passes the guards.
rpc_failover() {
    local cur
    cur="$(rpc_url)"
    [ -z "$_rpc_override" ] || return 1
    if $_rpc_server_error; then
        # A flapping endpoint can pass a probe right after failing the call.
        _rpc_log "$cur failed the call server-side"
    elif _rpc_probe_retry "$cur"; then
        return 1
    elif [ "$_rpc_kind" != down ]; then
        _rpc_log "$cur is unhealthy ($_rpc_why); not falling back"
        return 1
    else
        _rpc_log "$cur is down ($_rpc_why)"
    fi
    _rpc_fall_back_from "$cur"
}

# What the stellar CLI prints when the endpoint, not the call, failed: an
# HTTP 5xx, a JSON-RPC InternalError, or no response at all.
_rpc_server_side() { # stderr-file
    grep -Eqi 'Request rejected .5[0-9][0-9].|code: InternalError|error sending request|client error .(SendRequest|Connect).|error trying to connect|timed out|connection (refused|reset|closed)|dns error' "$1"
}

# `stellar <words> --rpc-url <chosen> --network-passphrase <p> <options...>`,
# once, logging the endpoint that served it. On failure, sets
# _rpc_server_error when the error was the endpoint's.
rpc_stellar_once() { # stellar-subcommand-words... options...
    local words=() url what="" prev="" a err rc=0
    while [ $# -gt 0 ] && [[ "$1" != -* ]]; do words+=("$1"); shift; done
    for a in "$@"; do
        case "$prev" in --id|--wasm-hash) what=" $a" ;; esac
        prev="$a"
    done
    url="$(rpc_url)"
    err="$(mktemp)"
    _rpc_server_error=false
    stellar "${words[@]}" --rpc-url "$url" --network-passphrase "$_rpc_pass" "$@" 2>"$err" || rc=$?
    cat "$err" >&2
    if [ "$rc" -ne 0 ]; then
        ! _rpc_server_side "$err" || _rpc_server_error=true
        rm -f "$err"
        return "$rc"
    fi
    rm -f "$err"
    _rpc_log "${words[*]}$what <- $url"
}

# rpc_stellar_once, retrying a server-side failure on the same endpoint, then
# moving to a fallback (and repeating) when the endpoint failed the call.
rpc_stellar() { # stellar-subcommand-words... options...
    local rc try delay
    while :; do
        try=1 delay=1
        while :; do
            rc=0
            rpc_stellar_once "$@" || rc=$?
            [ "$rc" -ne 0 ] || return 0
            $_rpc_server_error && [ "$try" -lt "${PERCH_RPC_CALL_ATTEMPTS:-3}" ] || break
            _rpc_log "server-side failure on $(rpc_url), try $try; retrying in ${delay}s"
            sleep "$delay"
            try=$((try + 1)) delay=$((delay * 2))
        done
        rpc_failover || return "$rc"
    done
}

# One JSON-RPC call; prints its `result`.
rpc_json() { # method
    local url
    while :; do
        url="$(rpc_url)"
        _rpc_post "$url" "$1"
        if [ "$_rpc_code" = 200 ] && jq -e '.result' >/dev/null 2>&1 <<<"$_rpc_body"; then
            _rpc_log "$1 <- $url"
            jq -c '.result' <<<"$_rpc_body"
            return 0
        fi
        _rpc_server_error=false
        case "$_rpc_code" in 000|5*) _rpc_server_error=true ;; esac
        [ "$(jq -r '.error.code // empty' <<<"$_rpc_body" 2>/dev/null)" != -32603 ] || _rpc_server_error=true
        rpc_failover || { _rpc_log "error: $1 failed against $url (HTTP $_rpc_code)"; return 1; }
    done
}
