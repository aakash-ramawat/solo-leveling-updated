import { Router, type NextFunction, type Request, type Response } from 'express';
import { getLevelXpRates, getTodayDate } from '@solo-leveling/shared';
import { prisma } from '../db.js';
import { adjustPlayerXp, getOrCreatePlayer } from '../game.js';

export const questRouter = Router();

// GET /api/quests — get today's quest (rolls once per day, 10% chance)
questRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const player = await getOrCreatePlayer();
    const today = getTodayDate();

    let activeQuest = await prisma.activeQuest.findUnique({ where: { date: today } });

    if (!activeQuest) {
      const hit = Math.random() < 0.1;

      if (hit) {
        const poolCount = await prisma.quest.count({ where: { playerId: player.id } });

        if (poolCount > 0) {
          const skip = Math.floor(Math.random() * poolCount);
          const [quest] = await prisma.quest.findMany({
            where: { playerId: player.id },
            skip,
            take: 1,
          });

          activeQuest = await prisma.activeQuest.create({
            data: {
              date: today,
              questId: quest.id,
              title: quest.title,
              status: 'active',
              playerId: player.id,
            },
          });
        } else {
          activeQuest = await prisma.activeQuest.create({
            data: {
              date: today,
              questId: null,
              title: null,
              status: 'failed',
              playerId: player.id,
            },
          });
        }
      } else {
        activeQuest = await prisma.activeQuest.create({
          data: {
            date: today,
            questId: null,
            title: null,
            status: 'failed',
            playerId: player.id,
          },
        });
      }
    }

    const hasQuest = activeQuest.questId !== null && activeQuest.status === 'active';

    const rates = getLevelXpRates(player.level);
    const rewardXp = rates.baseGain * 20;
    const penaltyXp = rates.baseLoss * 30;

    res.json({
      success: true,
      data: {
        date: today,
        hasQuest,
        quest: hasQuest
          ? { id: activeQuest.id, title: activeQuest.title, status: activeQuest.status }
          : null,
        rewardXp,
        penaltyXp,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/quests — add a quest to the pool
questRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const player = await getOrCreatePlayer();
    const { title } = req.body as { title: string };

    if (!title || !title.trim()) {
      res.status(400).json({ success: false, error: 'title is required' });
      return;
    }

    const quest = await prisma.quest.create({
      data: {
        title: title.trim(),
        playerId: player.id,
      },
    });

    res.json({ success: true, data: quest });
  } catch (err) {
    next(err);
  }
});

// POST /api/quests/:id/complete — complete today's active quest
questRouter.post('/:id/complete', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;

    const activeQuest = await prisma.activeQuest.findUnique({ where: { id } });
    if (!activeQuest || activeQuest.status !== 'active') {
      res.status(404).json({ success: false, error: 'Active quest not found' });
      return;
    }

    const player = await prisma.player.findUnique({ where: { id: activeQuest.playerId } });
    if (!player) {
      res.status(404).json({ success: false, error: 'Player not found' });
      return;
    }

    // Claim the quest first so a double tap can't reward it twice
    const claimed = await prisma.activeQuest.updateMany({
      where: { id, status: 'active' },
      data: { status: 'completed' },
    });
    if (claimed.count === 0) {
      res.status(404).json({ success: false, error: 'Active quest not found' });
      return;
    }

    if (activeQuest.questId) {
      await prisma.quest.delete({ where: { id: activeQuest.questId } }).catch(() => {});
    }

    const rates = getLevelXpRates(player.level);
    const rewardXp = rates.baseGain * 20;
    await adjustPlayerXp(player.id, rewardXp);
    await prisma.player.update({
      where: { id: player.id },
      data: { skipPasses: { increment: 1 } },
    });

    res.json({ success: true, data: { xpGained: rewardXp, skipPassEarned: true } });
  } catch (err) {
    next(err);
  }
});

// POST /api/quests/:id/fail — give up on today's active quest
questRouter.post('/:id/fail', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;

    const activeQuest = await prisma.activeQuest.findUnique({ where: { id } });
    if (!activeQuest || activeQuest.status !== 'active') {
      res.status(404).json({ success: false, error: 'Active quest not found' });
      return;
    }

    const player = await prisma.player.findUnique({ where: { id: activeQuest.playerId } });
    if (!player) {
      res.status(404).json({ success: false, error: 'Player not found' });
      return;
    }

    const claimed = await prisma.activeQuest.updateMany({
      where: { id, status: 'active' },
      data: { status: 'failed' },
    });
    if (claimed.count === 0) {
      res.status(404).json({ success: false, error: 'Active quest not found' });
      return;
    }

    const rates = getLevelXpRates(player.level);
    const penaltyXp = rates.baseLoss * 30;
    await adjustPlayerXp(player.id, -penaltyXp);

    res.json({ success: true, data: { xpLost: penaltyXp } });
  } catch (err) {
    next(err);
  }
});
