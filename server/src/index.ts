import path from 'path';
import { fileURLToPath } from 'url';
import { createApp } from './app.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT ?? '3001', 10);

// In production, also serve the built React app
const app = createApp({
  clientDist: process.env.NODE_ENV === 'production' ? path.resolve(__dirname, '../../client/dist') : undefined,
});

app.listen(PORT, () => {
  console.log(`⚔️  Solo Leveling server running on http://localhost:${PORT}`);
});
