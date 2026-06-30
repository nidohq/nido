import { handleResolve } from "./handler.js";
import { makeRegistry } from "./registry.js";

export interface ResolverEnv {
  NIDO_NETWORK: string;
  NIDO_RPC_URL: string;
  NIDO_REGISTRY_ID: string;
  NIDO_NETWORK_PASSPHRASE: string;
}

export default {
  fetch(request: Request, env: ResolverEnv): Promise<Response> {
    const registry = makeRegistry({
      rpcUrl: env.NIDO_RPC_URL,
      registryId: env.NIDO_REGISTRY_ID,
      networkPassphrase: env.NIDO_NETWORK_PASSPHRASE,
    });
    return handleResolve(request, registry, env.NIDO_NETWORK);
  },
};
