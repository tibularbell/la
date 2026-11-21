import { handleApiRequest } from './functions/api/[[route]]';
import type { EdgeEnv } from './functions/api/[[route]]';

interface AssetsFetcher {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}

interface WorkerEnv extends EdgeEnv {
  ASSETS: AssetsFetcher;
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return handleApiRequest(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
