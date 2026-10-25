import { Router, type NextFunction, type Request, type Response } from 'express';
import {
  APP_TIME_ZONE,
  calculateTaskXpLoss,
  getLevelInfo,
  getLevelXpRates,
  getMsUntilMidnight,
  getTodayDate,
  MAX_LEVEL,
} from '@solo-leveling/shared';
import { prisma } from '../db.js';
import { secretsMatch } from '../auth.js';
import { CATEGORIES, getDayProgress, previewMissedPenalties } from '../game.js';

export const summaryRouter = Router();

// GET /api/summary?key=<SUMMARY_KEY> — read-only snapshot for scheduled check-ins.
// It never writes: no penalties, no DayLog, no quest roll.
summaryRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const expected = process.env.SUMMARY_KEY;
    if (!expected) {
      res.status(503).json({ success: false, error: 'SUMMARY_KEY is not configured' });
      return;
    }
    const given = typeof req.query.key === 'string' ? req.query.key : req.get('x-summary-key');
    if (!secretsMatch(given, expected)) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const player = await prisma.player.findFirst();
    if (!player) {
      res.status(404).json({ success: false, error: 'Player not found' });
      return;
    }

    const today = getTodayDate();
    const info = getLevelInfo(player.level);
    const next = player.level < MAX_LEVEL ? getLevelInfo(player.level + 1) : null;
    const progress = await getDayProgress(player, today);
    const pending = await previewMissedPenalties(player, today);
    const dayLog = await prisma.dayLog.findUnique({ where: { date: today } });
    const activeQuest = await prisma.activeQuest.findUnique({ where: { date: today } });
    const rates = getLevelXpRates(player.level);

    const remaining = { total: 0, growth: 0, hobby: 0, self_care: 0 };
    let xpAtRisk = 0;
    for (const c of CATEGORIES) {
      remaining[c] = Math.max(0, progress.required[c] - progress.completed[c] - progress.failed[c]);
      remaining.total += remaining[c];
      xpAtRisk += remaining[c] * calculateTaskXpLoss(player.level, c);
    }

    res.json({
      success: true,
      data: {
        date: today,
        timeZone: APP_TIME_ZONE,
        generatedAt: new Date().toISOString(),
        hoursLeftToday: Math.round((getMsUntilMidnight() / 3_600_000) * 10) / 10,
        openedToday: dayLog !== null,
        player: {
          name: player.name,
          rank: info.rank,
          title: info.title,
          level: player.level,
          xp: player.xp,
          nextRank: next ? { rank: next.rank, title: next.title, xpNeeded: Math.max(0, next.xpToEnter - player.xp) } : null,
          skipPasses: player.skipPasses,
        },
        today: {
          required: progress.required,
          completed: progress.completed,
          failed: progress.failed,
          remaining,
          xpGained: progress.xpGainedToday,
          xpLost: progress.xpLostToday,
          xpNet: progress.xpNetToday,
          xpAtRiskIfMissed: xpAtRisk,
          slots: progress.tasks.map((t) => ({ category: t.category, title: t.title, status: t.status })),
        },
        // Missed past days not yet penalised (applied the next time the app opens)
        pendingPenalties: {
          days: pending.days.map((d) => ({ date: d.date, missing: d.missing, xpLoss: d.xpLoss })),
          totalXpLoss: pending.totalXpLoss,
        },
        quest: {
          rolledToday: activeQuest !== null,
          active:
            activeQuest?.questId && activeQuest.status === 'active'
              ? { title: activeQuest.title, rewardXp: rates.baseGain * 20, penaltyXp: rates.baseLoss * 30 }
              : null,
          completedToday: activeQuest?.status === 'completed' && activeQuest.questId !== null,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});
