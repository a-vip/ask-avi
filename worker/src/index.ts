import { handleGeminiProxyRequest, type ProxyEnv } from '../../shared/geminiProxy';

export default {
  async fetch(request: Request, env: ProxyEnv): Promise<Response> {
    return handleGeminiProxyRequest(request, env);
  },
};
