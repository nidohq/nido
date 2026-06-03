import * as Client from 'status_message';
import { rpcUrl } from './util';

export default new Client.Client({
  networkPassphrase: 'Test SDF Network ; September 2015',
  contractId: 'CBXVJXHPSYORSAHPX4I6NYPQMDJWK2STQCE6JTIM7FNV4OZSIDJFGNDM',
  rpcUrl,
  publicKey: undefined,
});
