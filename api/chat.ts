import { handleGeminiProxyRequest } from '../shared/geminiProxy';

export const config = {
  runtime: 'edge',
};

export default async function handler(request: Request): Promise<Response> {
  return handleGeminiProxyRequest(request, {
    GROQ_API_KEY: process.env.GROQ_API_KEY,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
  });
}
