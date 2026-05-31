import { Buffer } from 'buffer';
import { Client as SmartAccountClient } from 'smart-account';
import { extractXdrOperations } from '../assembledTx.js';
import { registerPolicyBlockModule } from './registry.js';
const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';
export const scopedSessionKeyModule = {
    kind: 'scoped-session-key',
    async buildInstall(args) {
        if (!args.verifierAddress) {
            throw new Error('scoped-session-key: verifierAddress fetcher required');
        }
        const verifierAddr = await args.verifierAddress();
        const client = new SmartAccountClient({
            contractId: args.account,
            networkPassphrase: TESTNET_PASSPHRASE,
            rpcUrl: args.rpcUrl,
        });
        const tx = await client.add_context_rule({
            context_type: { tag: 'CallContract', values: [args.block.targetContract] },
            name: args.block.label ?? 'session',
            valid_until: args.block.validUntil,
            signers: [{
                    tag: 'External',
                    values: [verifierAddr, Buffer.from(args.block.sessionPubkey)],
                }],
            policies: new Map(),
        });
        return {
            operations: extractXdrOperations(tx, 'scoped-session-key'),
            description: `Delegate session key to ${args.block.targetContract}`,
        };
    },
    async buildRevoke(args) {
        const client = new SmartAccountClient({
            contractId: args.account,
            networkPassphrase: TESTNET_PASSPHRASE,
            rpcUrl: args.rpcUrl,
        });
        const tx = await client.remove_context_rule({ context_rule_id: args.ruleId });
        return {
            operations: extractXdrOperations(tx, 'scoped-session-key'),
            description: 'Revoke session key',
        };
    },
    fromChain(rule, _state, overlay) {
        if (rule.policies.length > 0)
            return null;
        if (rule.contextType.kind !== 'call-contract')
            return null;
        if (rule.signers.length !== 1)
            return null;
        const s = rule.signers[0];
        if (s.kind !== 'external')
            return null;
        const target = rule.contextType.contract;
        const material = overlay.sessionKeyMaterial[target];
        return {
            kind: 'scoped-session-key',
            ruleId: rule.ruleId,
            targetContract: target,
            sessionPubkey: s.publicKey,
            credentialId: material?.credentialId ?? 'unknown',
            validUntil: rule.validUntil ?? undefined,
            label: material?.label ?? overlay.blockLabels[rule.ruleId],
        };
    },
    summarize(block) {
        const exp = block.validUntil != null ? ` (expires at ledger ${block.validUntil})` : '';
        return `Session key for ${block.targetContract}${exp}`;
    },
    defaultDraft() {
        return {
            kind: 'scoped-session-key',
            targetContract: '',
            sessionPubkey: new Uint8Array(65),
            credentialId: '',
        };
    },
};
registerPolicyBlockModule(scopedSessionKeyModule);
//# sourceMappingURL=scopedSessionKey.js.map