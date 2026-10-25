import { Router, type NextFunction, type Request, type Response } from 'express';
import { calculateTaskXpGain, calculateTaskXpLoss } from '@solo-leveling/shared';
import type { TaskCategory } from '@solo-leveling/shared';
import { prisma } from '../db.js';
import { adjustPlayerXp } from '../game.js';

export const taskRouter = Router();

// List tasks (optionally filter by status or category)
taskRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, category } = req.query;
    const player = await prisma.player.findFirst();

    if (!player) {
      res.status(404).json({ success: false, error: 'Player not found' });
      return;
    }

    const tasks = await prisma.task.findMany({
      where: {
        playerId: player.id,
        ...(status ? { status: status as string } : {}),
        ...(category ? { category: category as string } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: tasks });
  } catch (err) {
    next(err);
  }
});

// Create task — XP gain/loss auto-calculated from player's current level + category
taskRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const player = await prisma.player.findFirst();
    if (!player) {
      res.status(404).json({ success: false, error: 'Player not found' });
      return;
    }

    const { title, description, category } = req.body as {
      title: string;
      description?: string;
      category: TaskCategory;
    };

    if (!title || !category) {
      res.status(400).json({ success: false, error: 'title and category are required' });
      return;
    }

    const xpGain = calculateTaskXpGain(player.level, category);
    const xpLoss = calculateTaskXpLoss(player.level, category);

    const task = await prisma.task.create({
      data: {
        title,
        description: description || '',
        category,
        xpGain,
        xpLoss,
        playerId: player.id,
      },
    });

    res.json({ success: true, data: task });
  } catch (err) {
    next(err);
  }
});

// Complete task → gain XP
taskRouter.put('/:id/complete', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const task = await prisma.task.findUnique({ where: { id: req.params.id as string } });

    if (!task) {
      res.status(404).json({ success: false, error: 'Task not found' });
      return;
    }

    if (task.status !== 'active') {
      res.status(400).json({ success: false, error: 'Task is not active' });
      return;
    }

    const updatedTask = await prisma.task.update({
      where: { id: task.id },
      data: {
        status: 'completed',
        completedAt: new Date(),
      },
    });

    await adjustPlayerXp(task.playerId, task.xpGain);

    res.json({ success: true, data: updatedTask });
  } catch (err) {
    next(err);
  }
});

// Fail task → lose XP
taskRouter.put('/:id/fail', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const task = await prisma.task.findUnique({ where: { id: req.params.id as string } });

    if (!task) {
      res.status(404).json({ success: false, error: 'Task not found' });
      return;
    }

    if (task.status !== 'active') {
      res.status(400).json({ success: false, error: 'Task is not active' });
      return;
    }

    const updatedTask = await prisma.task.update({
      where: { id: task.id },
      data: { status: 'failed' },
    });

    await adjustPlayerXp(task.playerId, -task.xpLoss);

    res.json({ success: true, data: updatedTask });
  } catch (err) {
    next(err);
  }
});
