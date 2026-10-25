// Vercel serverless function: every /api/* request is rewritten here (see vercel.json).
// The static React app in client/dist is served by Vercel directly.
import { createApp } from '../server/dist/app.js';

export default createApp();
