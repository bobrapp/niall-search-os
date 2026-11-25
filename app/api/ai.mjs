import { handleAI } from '../server/ai.mjs';

export const config = { api: { bodyParser: false } };
export default function handler(request, response) {
  return handleAI(request, response, process.env);
}
