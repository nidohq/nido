import { installTestAuthenticator } from './shim';

const cfg = (window as any).__TEST_AUTH_CONFIG__;
if (cfg) installTestAuthenticator(cfg);
