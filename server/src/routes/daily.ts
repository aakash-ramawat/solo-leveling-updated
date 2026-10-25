import { Router, type NextFunction, type Request, type Response } from 'express';
import { calculateTaskXpGain, calculateTaskXpLoss, getDayRange, getTodayDate } from '@solo-leveling/shared';
import type { TaskCategory } from '@solo-leveling/shared';
import { prisma } from '../db.js';
import { adjustPlayerXp, getDayProgress, getOrCreatePlayer, isTaskCategory, settleMissedDays } from '../game.js';

export const dailyRouter = Router();

// POST /api/daily/sync — settle penalties for missed past days and start today.
// The app calls this once when it opens; reads never change the score.
dailyRouter.post('/sync', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const today = getTodayDate();
    await settleMissedDays(today);
    res.json({ success: true, data: { date: today } });
  } catch (err) {
    next(err);
  }
});

// GET /api/daily — today's progress with XP summary (read-only)
dailyRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const player = await getOrCreatePlayer();
    res.json({ success: true, data: await getDayProgress(player, getTodayDate()) });
  } catch (err) {
    next(err);
  }
});

// POST /api/daily/mark — mark a task slot as done or not done
dailyRouter.post('/mark', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const player = await getOrCreatePlayer();

    const { category, done, subtitle } = req.body as { category: TaskCategory; done: boolean; subtitle?: string };

    if (!isTaskCategory(category) || typeof done !== 'boolean') {
      res.status(400).json({ success: false, error: 'category and done are required' });
      return;
    }

    const xpGain = calculateTaskXpGain(player.level, category);
    const xpLoss = calculateTaskXpLoss(player.level, category);

    const task = await prisma.task.create({
      data: {
        title: subtitle?.trim() || `${category} task`,
        category,
        status: done ? 'completed' : 'failed',
        xpGain,
        xpLoss,
        playerId: player.id,
        completedAt: done ? new Date() : null,
      },
    });

    await adjustPlayerXp(player.id, done ? xpGain : -xpLoss);

    res.json({ success: true, data: task });
  } catch (err) {
    next(err);
  }
});

// POST /api/daily/unmark — undo a marked task slot (revert XP)
dailyRouter.post('/unmark', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { taskId } = req.body as { taskId: string };

    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) {
      res.status(404).json({ success: false, error: 'Task not found' });
      return;
    }

    // Undo only works for today's slots
    const { start, end } = getDayRange(getTodayDate());
    if (task.createdAt < start || task.createdAt > end) {
      res.status(400).json({ success: false, error: 'Only today\'s challenges can be undone' });
      return;
    }

    // Delete first so a double tap can't revert the XP twice
    const deleted = await prisma.task.deleteMany({ where: { id: taskId } });
    if (deleted.count === 0) {
      res.status(404).json({ success: false, error: 'Task not found' });
      return;
    }

    if (task.status === 'completed') {
      await adjustPlayerXp(task.playerId, -task.xpGain);
    } else if (task.status === 'failed') {
      await adjustPlayerXp(task.playerId, task.xpLoss);
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/daily/skip — use a skip pass to mark a task slot as completed (no XP change)
dailyRouter.post('/skip', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const player = await getOrCreatePlayer();

    const { category } = req.body as { category: TaskCategory };
    if (!isTaskCategory(category)) {
      res.status(400).json({ success: false, error: 'category is required' });
      return;
    }

    // Spend the pass only if one is left, atomically
    const spent = await prisma.player.updateMany({
      where: { id: player.id, skipPasses: { gt: 0 } },
      data: { skipPasses: { decrement: 1 } },
    });
    if (spent.count === 0) {
      res.status(400).json({ success: false, error: 'No skip passes available' });
      return;
    }

    await prisma.task.create({
      data: {
        title: `${category} task (skipped)`,
        category,
        status: 'completed',
        xpGain: 0,
        xpLoss: 0,
        playerId: player.id,
        completedAt: new Date(),
      },
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});
