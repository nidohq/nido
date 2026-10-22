#!/usr/bin/env python3
"""Tests for scripts/check-factory.sh: the factory record and the manifest's
perch-account against what the chain says the factory deploys.

Each case runs the script in a fake checkout (the two scripts it needs, a
Perch submodule that is a git repo holding one manifest, and a factory
record) with a fake `stellar` on PATH answering the instance read and the
`account_wasm_hash` simulation. RPC_URL is set, so nothing is probed. Run:
python3 scripts/test_check_factory.py
"""

import json
import os
import shutil
import subprocess
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TESTNET = "Test SDF Network ; September 2015"
FACTORY = "C" + "A" * 55
VERIFIER = "C" + "B" * 55
ADMIN = "G" + "C" * 55
WASM = "f" * 64
PINNED = "a" * 64
OTHER = "b" * 64

FAKE_STELLAR = r"""#!/usr/bin/env bash
case "$*" in
    "ledger entry fetch contract-data"*) cat "$FAKE_INSTANCE" ;;
    "contract invoke"*" -- account_wasm_hash")
        [ -n "$FAKE_ACCOUNT" ] || { echo "error: HostError: Error(WasmVm, MissingValue)" >&2; exit 1; }
        echo "\"$FAKE_ACCOUNT\"" ;;
    *) echo "fake stellar: unexpected: $*" >&2; exit 2 ;;
esac
"""


def git(cwd, *args):
    subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", *args],
                   cwd=cwd, check=True, capture_output=True)


class CheckFactory(unittest.TestCase):
    def run_check(self, manifest_account, record_account, chain_account=None, cached=None,
                  built_at_head=True):
        """`chain_account` is what `account_wasm_hash` returns (None: the
        factory has no such call); `cached` is an `Account` in its instance."""
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d)
        os.makedirs(f"{d}/scripts")
        for name in ("check-factory.sh", "stellar-rpc.sh"):
            shutil.copy(f"{ROOT}/scripts/{name}", f"{d}/scripts/{name}")

        perch = f"{d}/vendor/perch"
        os.makedirs(f"{perch}/deployments")
        with open(f"{perch}/deployments/testnet.json", "w") as f:
            json.dump({"network": "testnet", "network_passphrase": TESTNET,
                       "rpc_url": "http://127.0.0.1:9",
                       "contracts": {"perch-account": {"sha256": manifest_account}}}, f)
        git(perch, "init", "-q")
        git(perch, "add", ".")
        git(perch, "commit", "-qm", "manifest")
        head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=perch, check=True,
                              capture_output=True, text=True).stdout.strip()

        record = f"{d}/packages/passkey-sdk/src/perch/factory.testnet.json"
        os.makedirs(os.path.dirname(record))
        with open(record, "w") as f:
            json.dump({"network": "testnet", "network_passphrase": TESTNET, "factory": FACTORY,
                       "wasm_hash": WASM, "account_wasm_hash": record_account,
                       "pinned_verifier": VERIFIER, "admin": ADMIN, "manager": None,
                       "source": {"perch_commit": head if built_at_head else "0" * 40}}, f)

        storage = [{"key": {"symbol": "PinnedVerifier"}, "val": {"address": VERIFIER}},
                   {"key": {"symbol": "ADMIN"}, "val": {"address": ADMIN}}]
        if cached:
            storage.append({"key": {"symbol": "Account"}, "val": {"bytes": cached}})
        instance = f"{d}/instance.json"
        with open(instance, "w") as f:
            json.dump({"val": {"contract_instance": {"executable": {"wasm": WASM},
                                                      "storage": storage}}}, f)

        os.makedirs(f"{d}/bin")
        with open(f"{d}/bin/stellar", "w") as f:
            f.write(FAKE_STELLAR)
        os.chmod(f"{d}/bin/stellar", 0o755)

        env = {k: v for k, v in os.environ.items() if k != "STELLAR_RPC_URL" and not k.startswith("PERCH_")}
        env.update(PATH=f"{d}/bin:{env['PATH']}", RPC_URL="http://127.0.0.1:9",
                   FAKE_INSTANCE=instance, FAKE_ACCOUNT=chain_account or "")
        return subprocess.run(["bash", f"{d}/scripts/check-factory.sh", "testnet"],
                              capture_output=True, text=True, env=env)

    def test_a_factory_pinning_the_manifests_account_passes(self):
        r = self.run_check(PINNED, PINNED, chain_account=PINNED)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn(f"account it deploys (account_wasm_hash): {PINNED}", r.stdout)
        self.assertIn("is the manifest's perch-account", r.stdout)

    def test_a_pin_the_manifest_does_not_name_fails(self):
        r = self.run_check(PINNED, OTHER, chain_account=OTHER)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn(f"deploys account {OTHER}", r.stderr)
        self.assertIn(f"names {PINNED}", r.stderr)

    def test_a_pin_the_record_does_not_name_fails(self):
        r = self.run_check(PINNED, PINNED, chain_account=OTHER)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn(f"account it deploys (account_wasm_hash) is {OTHER} on chain", r.stderr)

    def test_a_left_over_cache_does_not_hide_the_pin(self):
        r = self.run_check(PINNED, PINNED, chain_account=PINNED, cached=OTHER)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn(f"(account_wasm_hash): {PINNED}", r.stdout)

    def test_a_factory_from_before_the_pin_is_read_from_its_cache(self):
        r = self.run_check(PINNED, PINNED, cached=PINNED)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn(f"(the Account cache of a factory from before the pin): {PINNED}", r.stdout)

    def test_a_factory_built_at_an_earlier_perch_commit_is_reported_not_failed(self):
        r = self.run_check(PINNED, OTHER, cached=OTHER, built_at_head=False)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("redeploy it (just deploy-factory)", r.stdout)

    def test_a_factory_whose_account_cannot_be_read_fails(self):
        r = self.run_check(PINNED, PINNED)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("cannot read the account hash", r.stderr)


if __name__ == "__main__":
    unittest.main()
