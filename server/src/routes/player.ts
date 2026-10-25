import { Router, type NextFunction, type Request, type Response } from 'express';
import { getLevelInfo, getLevelForXp, getDailyRequirements, getTodayDate, getDateString, addDays } from '@solo-leveling/shared';
import type { PlayerStats } from '@solo-leveling/shared';
import { prisma } from '../index.js';

export const playerRouter = Router();

async function computeStats(playerId: string, playerCreatedAt: Date, currentLevel: number): Promise<PlayerStats> {
  let dayLogs = await prisma.dayLog.findMany({
    where: { playerId },
    orderBy: { date: 'asc' },
  });

  const today = getTodayDate();
  const existingDates = new Set(dayLogs.map((d) => d.date));

  const missingDays: { date: string; level: number; playerId: string }[] = [];
  for (let ds = getDateString(playerCreatedAt); ds <= today; ds = addDays(ds, 1)) {
    if (!existingDates.has(ds)) {
      missingDays.push({ date: ds, level: currentLevel, playerId });
    }
  }

  if (missingDays.length > 0) {
    await prisma.dayLog.createMany({ data: missingDays });
    dayLogs = await prisma.dayLog.findMany({
      where: { playerId },
      orderBy: { date: 'asc' },
    });
  }

  let availableGrowth = 0;
  let availableHobby = 0;
  let availableSelfCare = 0;

  for (const log of dayLogs) {
    if (log.date > today) continue;
    const req = getDailyRequirements(log.level);
    availableGrowth += req.growth;
    availableHobby += req.hobby;
    availableSelfCare += req.self_care;
  }

  const availableTotal = availableGrowth + availableHobby + availableSelfCare;

  const completedTasks = await prisma.task.groupBy({
    by: ['category'],
    where: { playerId, status: 'completed' },
    _count: true,
  });

  const completedMap: Record<string, number> = {};
  for (const row of completedTasks) {
    completedMap[row.category] = row._count;
  }

  const completedGrowth = completedMap['growth'] || 0;
  const completedSelfCare = completedMap['self_care'] || 0;
  const completedTotal = (completedMap['growth'] || 0) + (completedMap['hobby'] || 0) + (completedMap['self_care'] || 0);

  return {
    intelligence: availableGrowth > 0 ? Math.round((completedGrowth / availableGrowth) * 100) : 0,
    charisma: availableSelfCare > 0 ? Math.round((completedSelfCare / availableSelfCare) * 100) : 0,
    willPower: availableTotal > 0 ? Math.round((completedTotal / availableTotal) * 100) : 0,
  };
}

// Get or create the single player
playerRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    let player = await prisma.player.findFirst();

    if (!player) {
      const info = getLevelInfo(1);
      player = await prisma.player.create({
        data: { title: info.title },
      });
    }

    const info = getLevelInfo(player.level);
    const stats = await computeStats(player.id, player.createdAt, player.level);

    res.json({
      success: true,
      data: {
        id: player.id,
        name: player.name,
        level: player.level,
        rank: info.rank,
        title: info.title,
        xp: player.xp,
        xpToEnter: info.xpToEnter,
        xpToPass: info.xpToPass,
        skipPasses: player.skipPasses,
        stats,
        createdAt: player.createdAt.toISOString(),
        updatedAt: player.updatedAt.toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
});

// Update player
playerRouter.put('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const player = await prisma.player.findFirst();
    if (!player) {
      res.status(404).json({ success: false, error: 'Player not found' });
      return;
    }

    const updated = await prisma.player.update({
      where: { id: player.id },
      data: req.body,
    });

    const info = getLevelInfo(updated.level);
    const stats = await computeStats(updated.id, updated.createdAt, updated.level);

    res.json({
      success: true,
      data: {
        id: updated.id,
        name: updated.name,
        level: updated.level,
        rank: info.rank,
        title: info.title,
        xp: updated.xp,
        xpToEnter: info.xpToEnter,
        xpToPass: info.xpToPass,
        stats,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
});
