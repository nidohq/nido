import { handleRelay, type RelayEnv } from "./handler.js";
export default {
  fetch(request: Request, env: RelayEnv): Promise<Response> { return handleRelay(request, env); },
};
