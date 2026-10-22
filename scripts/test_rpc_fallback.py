#!/usr/bin/env python3
"""Tests for the RPC endpoint choice: scripts/stellar-rpc.sh and the
`just perch-infra` wrapper scripts/perch-infra.sh.

Stub Soroban RPC and Horizon servers on localhost stand in for the real
endpoints; a fake Perch checkout (NIDO_PERCH_DIR) stands in for
vendor/perch, its fetch script recording the rpc_url of each manifest it was
handed. Run: python3 scripts/test_rpc_fallback.py
"""

import http.server
import json
import os
import subprocess
import tempfile
import threading
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HELPER = os.path.join(ROOT, "scripts", "stellar-rpc.sh")
WRAPPER = os.path.join(ROOT, "scripts", "perch-infra.sh")

TESTNET = "Test SDF Network ; September 2015"
MAINNET = "Public Global Stellar Network ; September 2015"
TIP = 5_214_327


class Stub:
    """A local RPC (or Horizon) endpoint: up with a passphrase and ledger, or down."""

    def __init__(self, passphrase=TESTNET, ledger=TIP, status=200):
        self.passphrase, self.ledger, self.status, self.hits = passphrase, ledger, status, 0
        stub = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def _send(self, body):
                stub.hits += 1
                if stub.status != 200:
                    self.send_response(stub.status)
                    self.end_headers()
                    self.wfile.write(b"no available server")
                    return
                data = json.dumps(body).encode()
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.end_headers()
                self.wfile.write(data)

            def do_POST(self):
                req = json.loads(self.rfile.read(int(self.headers["content-length"])))
                result = {
                    "getNetwork": {"passphrase": stub.passphrase, "protocolVersion": 29},
                    "getLatestLedger": {"sequence": stub.ledger, "protocolVersion": 29},
                }[req["method"]]
                self._send({"jsonrpc": "2.0", "id": req["id"], "result": result})

            def do_GET(self):  # Horizon root
                self._send({"network_passphrase": stub.passphrase, "history_latest_ledger": stub.ledger})

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


def base_env(**extra):
    env = {k: v for k, v in os.environ.items() if k not in ("RPC_URL", "STELLAR_RPC_URL") and not k.startswith("PERCH_")}
    env.update(PERCH_RPC_PROBE_ATTEMPTS="1", PERCH_RPC_TIMEOUT="3")
    env.update(extra)
    return env


class Case(unittest.TestCase):
    def stub(self, **kw):
        s = Stub(**kw)
        self.addCleanup(s.close)
        return s


class Select(Case):
    """rpc_select: which endpoint a run reads through."""

    def select(self, primary, passphrase=TESTNET, **env):
        script = f'. "{HELPER}"; rpc_select "$1" "$2" && rpc_url'
        return subprocess.run(["bash", "-c", script, "_", primary, passphrase],
                              env=base_env(**env), capture_output=True, text=True)

    def test_healthy_primary_is_used_and_fallbacks_untouched(self):
        primary, fb, hz = self.stub(), self.stub(), self.stub()
        r = self.select(primary.url, PERCH_RPC_FALLBACKS=fb.url, PERCH_HORIZON_URL=hz.url)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout, primary.url)
        self.assertEqual(fb.hits, 0)

    def test_primary_down_uses_fallback(self):
        primary, fb, hz = self.stub(status=503), self.stub(), self.stub()
        r = self.select(primary.url, PERCH_RPC_FALLBACKS=fb.url, PERCH_HORIZON_URL=hz.url)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout, fb.url)
        self.assertIn("is down (HTTP 503)", r.stderr)
        self.assertIn(f"using {fb.url} (fallback", r.stderr)

    def test_stale_fallback_refused_next_fresh_used(self):
        primary, stale, fresh, hz = self.stub(status=502), self.stub(ledger=2_070_000), self.stub(), self.stub()
        r = self.select(primary.url, PERCH_RPC_FALLBACKS=f"{stale.url} {fresh.url}", PERCH_HORIZON_URL=hz.url)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout, fresh.url)
        self.assertIn(f"refusing fallback {stale.url}: stale", r.stderr)

    def test_only_stale_fallback_fails(self):
        primary, stale, hz = self.stub(status=503), self.stub(ledger=2_070_000), self.stub()
        r = self.select(primary.url, PERCH_RPC_FALLBACKS=stale.url, PERCH_HORIZON_URL=hz.url)
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(r.stdout, "")

    def test_wrong_network_fallback_refused(self):
        primary, wrong, hz = self.stub(status=503), self.stub(passphrase=MAINNET), self.stub()
        r = self.select(primary.url, PERCH_RPC_FALLBACKS=wrong.url, PERCH_HORIZON_URL=hz.url)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn(f"refusing fallback {wrong.url}: wrong network", r.stderr)

    def test_fallback_nobody_can_vouch_for_is_refused(self):
        primary, fb = self.stub(status=503), self.stub()
        r = self.select(primary.url, PERCH_RPC_FALLBACKS=fb.url, PERCH_HORIZON_URL="")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("no other source answered", r.stderr)

    def test_override_wins(self):
        for var in ("RPC_URL", "STELLAR_RPC_URL"):
            with self.subTest(var=var):
                primary, fb = self.stub(), self.stub()
                r = self.select(primary.url, PERCH_RPC_FALLBACKS=fb.url, **{var: "http://127.0.0.1:9/override"})
                self.assertEqual(r.returncode, 0, r.stderr)
                self.assertEqual(r.stdout, "http://127.0.0.1:9/override")
                self.assertEqual((primary.hits, fb.hits), (0, 0))

    def test_misconfigured_primary_is_not_routed_around(self):
        primary, fb, hz = self.stub(passphrase=MAINNET), self.stub(), self.stub()
        r = self.select(primary.url, PERCH_RPC_FALLBACKS=fb.url, PERCH_HORIZON_URL=hz.url)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("not falling back", r.stderr)
        self.assertEqual(fb.hits, 0)

    def test_mainnet_has_no_default_fallback(self):
        primary = self.stub(status=503, passphrase=MAINNET)
        r = self.select(primary.url, MAINNET, PERCH_HORIZON_URL="")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn(f"no usable fallback after {primary.url}", r.stderr)


FAKE_FETCH = r"""#!/usr/bin/env bash
# Fake fetch-infra-wasm.sh. MARKER
set -euo pipefail
while [ $# -gt 0 ]; do case "$1" in --manifest) manifest="$2"; shift 2 ;; *) shift ;; esac; done
url="$(jq -r .rpc_url "$manifest")"
echo "$url" >>"$FAKE_LOG"
case " $FAKE_GOOD " in *" $url "*) exit 0 ;; esac
case "$FAKE_FAIL" in
    hash) echo "error: perch-account: fetched aa, manifest says bb" >&2 ;;
    *) echo "error: perch-account: fetch failed after 5 attempts: error: Networking or low-level protocol error: HTTP error: Request rejected \`502\`" >&2 ;;
esac
exit 1
"""


class PerchInfra(Case):
    """scripts/perch-infra.sh, against a fake Perch checkout."""

    def test_writes_the_factory_pin_from_the_manifest(self):
        primary = self.stub()
        r, _ = self.run_wrapper(primary.url, good=[primary.url], account="c" * 64)
        self.assertEqual(r.returncode, 0, r.stderr)
        with open(self.pin) as f:
            self.assertEqual(f.read(), "c" * 64 + "\n")

    def test_a_manifest_without_an_account_hash_pins_nothing_and_fetches_nothing(self):
        primary = self.stub()
        r, runs = self.run_wrapper(primary.url, good=[primary.url], account=None)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("has no perch-account hash for the factory to pin", r.stderr)
        self.assertFalse(os.path.exists(self.pin))
        self.assertEqual(runs, [])

    def run_wrapper(self, primary, good=(), fail="endpoint", native=False, account="a" * 64, **env):
        d = tempfile.mkdtemp()
        self.pin = f"{d}/pin"
        os.makedirs(f"{d}/deployments")
        os.makedirs(f"{d}/scripts")
        with open(f"{d}/deployments/testnet.json", "w") as f:
            json.dump({"network_passphrase": TESTNET, "rpc_url": primary,
                       "contracts": {"perch-account": {"sha256": account}} if account else {}}, f)
        with open(f"{d}/scripts/fetch-infra-wasm.sh", "w") as f:
            f.write(FAKE_FETCH.replace("MARKER", "Sources scripts/stellar-rpc.sh." if native else ""))
        log = f"{d}/log"
        open(log, "w").close()
        r = subprocess.run(["bash", WRAPPER], capture_output=True, text=True,
                           env=base_env(NIDO_PERCH_DIR=d, NIDO_FACTORY_PIN=self.pin, FAKE_LOG=log,
                                        FAKE_GOOD=" ".join(good),
                                        FAKE_FAIL=fail, PERCH_RPC_CALL_ATTEMPTS="1", **env))
        with open(log) as f:
            return r, f.read().split()

    def test_endpoint_failing_mid_run_moves_to_fallback(self):
        primary, fb, hz = self.stub(), self.stub(), self.stub()
        r, runs = self.run_wrapper(primary.url, good=[fb.url], PERCH_RPC_FALLBACKS=fb.url, PERCH_HORIZON_URL=hz.url)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(runs, [primary.url, fb.url])
        self.assertIn(f"every fetch in this run <- {fb.url}", r.stderr)

    def test_primary_down_at_start_goes_straight_to_fallback(self):
        primary, fb, hz = self.stub(status=503), self.stub(), self.stub()
        r, runs = self.run_wrapper(primary.url, good=[fb.url], PERCH_RPC_FALLBACKS=fb.url, PERCH_HORIZON_URL=hz.url)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(runs, [fb.url])

    def test_hash_mismatch_never_falls_back(self):
        primary, fb, hz = self.stub(), self.stub(), self.stub()
        r, runs = self.run_wrapper(primary.url, fail="hash", PERCH_RPC_FALLBACKS=fb.url, PERCH_HORIZON_URL=hz.url)
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(runs, [primary.url])
        self.assertIn("manifest says bb", r.stderr)
        self.assertEqual(fb.hits, 0)

    def test_stale_fallback_refused_mid_run(self):
        primary, stale, hz = self.stub(), self.stub(ledger=2_070_000), self.stub()
        r, runs = self.run_wrapper(primary.url, good=[stale.url], PERCH_RPC_FALLBACKS=stale.url, PERCH_HORIZON_URL=hz.url)
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(runs, [primary.url])
        self.assertIn("stale", r.stderr)

    def test_override_wins_and_is_not_routed_around(self):
        primary, fb, hz = self.stub(), self.stub(), self.stub()
        r, runs = self.run_wrapper(primary.url, good=[fb.url], RPC_URL="http://127.0.0.1:9/override",
                                   PERCH_RPC_FALLBACKS=fb.url, PERCH_HORIZON_URL=hz.url)
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(runs, ["http://127.0.0.1:9/override"])
        self.assertEqual((primary.hits, fb.hits), (0, 0))

    def test_perch_script_with_the_helper_is_run_as_is(self):
        primary = self.stub(status=503)
        r, runs = self.run_wrapper(primary.url, good=[primary.url], native=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(runs, [primary.url])  # the manifest itself, no copy
        self.assertEqual(primary.hits, 0)


if __name__ == "__main__":
    unittest.main()
