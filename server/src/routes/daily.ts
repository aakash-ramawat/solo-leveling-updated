import { Router, type NextFunction, type Request, type Response } from 'express';
import { getDailyRequirements, calculateTaskXpGain, calculateTaskXpLoss, getLevelForXp, getLevelInfo, getTodayDate, getDayRange } from '@solo-leveling/shared';
import type { TaskCategory } from '@solo-leveling/shared';
import { prisma } from '../index.js';

export const dailyRouter = Router();

async function updatePlayerXp(playerId: string, newXp: number) {
  const xp = Math.max(0, newXp);
  const level = getLevelForXp(xp);
  const info = getLevelInfo(level);
  return prisma.player.update({
    where: { id: playerId },
    data: { xp, level, title: info.title },
  });
}

async function getOrCreatePlayer() {
  let player = await prisma.player.findFirst();
  if (!player) {
    const info = getLevelInfo(1);
    player = await prisma.player.create({ data: { title: info.title } });
  }
  return player;
}

// Apply XP penalties for past days where required tasks weren't completed.
// Creates auto-failed task records so penalties are never applied twice.
async function applyMissedPenalties(player: Awaited<ReturnType<typeof getOrCreatePlayer>>) {
  const today = getTodayDate();

  const pastLogs = await prisma.dayLog.findMany({
    where: { playerId: player.id, date: { lt: today } },
    orderBy: { date: 'asc' },
  });

  const categories: TaskCategory[] = ['growth', 'hobby', 'self_care'];
  let xpDeduction = 0;
  const missedTasks: {
    title: string; category: string; status: string;
    xpGain: number; xpLoss: number; playerId: string; createdAt: Date;
  }[] = [];

  for (const log of pastLogs) {
    const required = getDailyRequirements(log.level);
    const { start: dayStart, end: dayEnd } = getDayRange(log.date);
    const createdAt = new Date(dayStart.getTime() + 12 * 60 * 60 * 1000); // noon — within the day's range

    const dayTasks = await prisma.task.findMany({
      where: { playerId: player.id, createdAt: { gte: dayStart, lte: dayEnd } },
    });

    for (const category of categories) {
      const slots = required[category];
      const filled = dayTasks.filter((t) => t.category === category).length; // completed + failed
      const missing = Math.max(0, slots - filled);

      if (missing > 0) {
        const xpLoss = calculateTaskXpLoss(log.level, category);
        for (let i = 0; i < missing; i++) {
          missedTasks.push({
            title: `${category} task (missed)`,
            category,
            status: 'failed',
            xpGain: 0,
            xpLoss,
            playerId: player.id,
            createdAt,
          });
          xpDeduction += xpLoss;
        }
      }
    }
  }

  if (missedTasks.length > 0) {
    await prisma.task.createMany({ data: missedTasks });
    return await updatePlayerXp(player.id, player.xp - xpDeduction);
  }

  return player;
}

// GET /api/daily — today's progress with XP summary
dailyRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    let player = await getOrCreatePlayer();

    // Penalise any past days where required tasks weren't completed
    player = await applyMissedPenalties(player);

    // Record today's level for stats computation
    const today = getTodayDate();
    await prisma.dayLog.upsert({
      where: { date: today },
      create: { date: today, level: player.level, playerId: player.id },
      update: { level: player.level },
    });

    const { start, end } = getDayRange(today);
    const required = getDailyRequirements(player.level);

    const todayTasks = await prisma.task.findMany({
      where: {
        playerId: player.id,
        createdAt: { gte: start, lte: end },
      },
    });

    const completed = {
      total: todayTasks.filter((t) => t.status === 'completed').length,
      growth: todayTasks.filter((t) => t.status === 'completed' && t.category === 'growth').length,
      hobby: todayTasks.filter((t) => t.status === 'completed' && t.category === 'hobby').length,
      self_care: todayTasks.filter((t) => t.status === 'completed' && t.category === 'self_care').length,
    };

    const failed = {
      total: todayTasks.filter((t) => t.status === 'failed').length,
      growth: todayTasks.filter((t) => t.status === 'failed' && t.category === 'growth').length,
      hobby: todayTasks.filter((t) => t.status === 'failed' && t.category === 'hobby').length,
      self_care: todayTasks.filter((t) => t.status === 'failed' && t.category === 'self_care').length,
    };

    const xpGainedToday = todayTasks
      .filter((t) => t.status === 'completed')
      .reduce((sum, t) => sum + t.xpGain, 0);

    const xpLostToday = todayTasks
      .filter((t) => t.status === 'failed')
      .reduce((sum, t) => sum + t.xpLoss, 0);

    const tasks = todayTasks.map((t) => ({
      id: t.id,
      title: t.title,
      category: t.category,
      status: t.status,
      xpGain: t.xpGain,
      xpLoss: t.xpLoss,
    }));

    res.json({
      success: true,
      data: {
        date: getTodayDate(),
        required,
        completed,
        failed,
        xpGainedToday,
        xpLostToday,
        xpNetToday: xpGainedToday - xpLostToday,
        tasks,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/daily/mark — mark a task slot as done or not done
dailyRouter.post('/mark', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const player = await getOrCreatePlayer();

    const { category, done, subtitle } = req.body as { category: TaskCategory; done: boolean; subtitle?: string };

    if (!category || done === undefined) {
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

    if (done) {
      await updatePlayerXp(player.id, player.xp + xpGain);
    } else {
      await updatePlayerXp(player.id, player.xp - xpLoss);
    }

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

    const player = await prisma.player.findUnique({ where: { id: task.playerId } });
    if (!player) {
      res.status(404).json({ success: false, error: 'Player not found' });
      return;
    }

    if (task.status === 'completed') {
      await updatePlayerXp(player.id, player.xp - task.xpGain);
    } else if (task.status === 'failed') {
      await updatePlayerXp(player.id, player.xp + task.xpLoss);
    }

    await prisma.task.delete({ where: { id: taskId } });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/daily/skip — use a skip pass to mark a task slot as completed (no XP change)
dailyRouter.post('/skip', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const player = await getOrCreatePlayer();

    if (player.skipPasses <= 0) {
      res.status(400).json({ success: false, error: 'No skip passes available' });
      return;
    }

    const { category } = req.body as { category: TaskCategory };
    if (!category) {
      res.status(400).json({ success: false, error: 'category is required' });
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

    await prisma.player.update({
      where: { id: player.id },
      data: { skipPasses: player.skipPasses - 1 },
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});
