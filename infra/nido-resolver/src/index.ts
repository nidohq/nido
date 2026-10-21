import { DEFAULT_APEXES, handleResolve } from "./handler.js";
import { makeRegistry } from "./registry.js";

export interface ResolverEnv {
  NIDO_NETWORK: string;
  NIDO_RPC_URL: string;
  NIDO_REGISTRY_ID: string;
  NIDO_NETWORK_PASSPHRASE: string;
  /** Comma-separated apexes whose one-label subdomains are accounts. */
  NIDO_APEXES?: string;
}

export default {
  fetch(request: Request, env: ResolverEnv): Promise<Response> {
    const registry = makeRegistry({
      rpcUrl: env.NIDO_RPC_URL,
      registryId: env.NIDO_REGISTRY_ID,
      networkPassphrase: env.NIDO_NETWORK_PASSPHRASE,
    });
    const apexes = env.NIDO_APEXES
      ? env.NIDO_APEXES.split(",").map((a) => a.trim()).filter(Boolean)
      : DEFAULT_APEXES;
    return handleResolve(request, registry, env.NIDO_NETWORK, apexes);
  },
};
