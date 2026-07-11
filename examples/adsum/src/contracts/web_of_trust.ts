import * as Client from 'web_of_trust';
import { rpcUrl } from './util';

export default new Client.Client({
  networkPassphrase: 'Test SDF Network ; September 2015',
  contractId: 'CDI5YRC4K54QHJW63ONUQPZ6GOAU254GP43OWGCPK3QVPUKPIQIQGIFS',
  rpcUrl,
  // This constructs the underlying rpc.Server at module-eval time, so a
  // LOCAL .env (http:// rpcUrl) without this would throw at import --
  // `allowHttp` defaults to false/unset otherwise. Derived from the URL
  // scheme rather than fixed, matching lib/rpc.ts's shared server.
  allowHttp: rpcUrl.startsWith('http://'),
  publicKey: undefined,
});
