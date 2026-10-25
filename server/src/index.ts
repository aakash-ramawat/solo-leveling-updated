import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { playerRouter } from './routes/player.js';
import { taskRouter } from './routes/task.js';
import { dailyRouter } from './routes/daily.js';
import { questRouter } from './routes/quest.js';
import { summaryRouter } from './routes/summary.js';
import { requireAppToken } from './auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT ?? '3001', 10);

app.use(express.json());

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', name: 'Solo Leveling API' });
});

// Read-only check-in summary, protected by its own SUMMARY_KEY
app.use('/api/summary', summaryRouter);

// Everything below needs the app token
app.use('/api', requireAppToken);

app.get('/api/auth/check', (_req, res) => {
  res.json({ success: true });
});

// Routes
app.use('/api/player', playerRouter);
app.use('/api/tasks', taskRouter);
app.use('/api/daily', dailyRouter);
app.use('/api/quests', questRouter);

// In production, serve the built React app and handle client-side routing
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.resolve(__dirname, '../../client/dist');
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

// Global error handler — must be last, after all routes
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[server error]', err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`⚔️  Solo Leveling server running on http://localhost:${PORT}`);
});
