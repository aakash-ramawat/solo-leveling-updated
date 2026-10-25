import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'path';
import { playerRouter } from './routes/player.js';
import { taskRouter } from './routes/task.js';
import { dailyRouter } from './routes/daily.js';
import { questRouter } from './routes/quest.js';
import { summaryRouter } from './routes/summary.js';
import { requireAppToken } from './auth.js';

// Builds the Express app. Used by the local/long-running server (index.ts)
// and by the Vercel serverless function (api/index.js).
export function createApp(options: { clientDist?: string } = {}) {
  const app = express();

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

  // Serve the built React app and handle client-side routing (not needed on Vercel)
  if (options.clientDist) {
    const clientDist = options.clientDist;
    app.use(express.static(clientDist));
    app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  }

  // Global error handler — must be last, after all routes
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[server error]', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  });

  return app;
}
