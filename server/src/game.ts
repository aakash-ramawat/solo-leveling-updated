import {
  addDays,
  calculateTaskXpLoss,
  getDailyRequirements,
  getDateString,
  getDayRange,
  getLevelForXp,
  getLevelInfo,
  getTodayDate,
} from '@solo-leveling/shared';
import type { TaskCategory } from '@solo-leveling/shared';
import type { Player, Task } from '@prisma/client';
import { prisma } from './db.js';

export const CATEGORIES: TaskCategory[] = ['growth', 'hobby', 'self_care'];

export function isTaskCategory(value: unknown): value is TaskCategory {
  return CATEGORIES.includes(value as TaskCategory);
}

export async function getOrCreatePlayer() {
  let player = await prisma.player.findFirst();
  if (!player) {
    const info = getLevelInfo(1);
    player = await prisma.player.create({ data: { title: info.title } });
  }
  return player;
}

// Add (or subtract) XP atomically, never below 0, and keep level, title and
// today's recorded level in step
export async function adjustPlayerXp(playerId: string, delta: number) {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.player.update({
      where: { id: playerId },
      data: { xp: { increment: delta } },
    });
    const xp = Math.max(0, updated.xp);
    const level = getLevelForXp(xp);
    await tx.dayLog.updateMany({ where: { playerId, date: getTodayDate() }, data: { level } });
    return tx.player.update({
      where: { id: playerId },
      data: { xp, level, title: getLevelInfo(level).title },
    });
  });
}

// --- Missed-day penalties ---

interface MissedDay {
  date: string;
  level: number;
  missing: Record<TaskCategory, number>;
  xpLoss: number;
}

function missingSlots(level: number, dayTasks: Pick<Task, 'category'>[]): MissedDay['missing'] {
  const required = getDailyRequirements(level);
  const missing = { growth: 0, hobby: 0, self_care: 0 };
  for (const category of CATEGORIES) {
    const filled = dayTasks.filter((t) => t.category === category).length; // completed + failed
    missing[category] = Math.max(0, required[category] - filled);
  }
  return missing;
}

function missedXp(level: number, missing: MissedDay['missing']): number {
  return CATEGORIES.reduce((sum, c) => sum + missing[c] * calculateTaskXpLoss(level, c), 0);
}

// Past days that have no DayLog yet (the app wasn't opened); they count at the current level
async function findUnloggedPastDays(player: Player, today: string): Promise<string[]> {
  const logs = await prisma.dayLog.findMany({ where: { playerId: player.id }, select: { date: true } });
  const logged = new Set(logs.map((l) => l.date));
  const dates: string[] = [];
  for (let d = getDateString(player.createdAt); d < today; d = addDays(d, 1)) {
    if (!logged.has(d)) dates.push(d);
  }
  return dates;
}

// Read-only: penalties that settleMissedDays() would apply right now
export async function previewMissedPenalties(player: Player, today: string) {
  const unsettled = await prisma.dayLog.findMany({
    where: { playerId: player.id, date: { lt: today }, settled: false },
  });
  const days = [
    ...unsettled.map((l) => ({ date: l.date, level: l.level })),
    ...(await findUnloggedPastDays(player, today)).map((date) => ({ date, level: player.level })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  if (days.length === 0) return { days: [] as MissedDay[], totalXpLoss: 0 };

  const tasks = await prisma.task.findMany({
    where: {
      playerId: player.id,
      createdAt: { gte: getDayRange(days[0].date).start, lte: getDayRange(days[days.length - 1].date).end },
    },
    select: { category: true, createdAt: true },
  });

  const missed: MissedDay[] = [];
  for (const day of days) {
    const dayTasks = tasks.filter((t) => getDateString(t.createdAt) === day.date);
    const missing = missingSlots(day.level, dayTasks);
    const xpLoss = missedXp(day.level, missing);
    if (CATEGORIES.some((c) => missing[c] > 0)) missed.push({ ...day, missing, xpLoss });
  }
  return { days: missed, totalXpLoss: missed.reduce((sum, d) => sum + d.xpLoss, 0) };
}

// Apply XP penalties for past days where required slots weren't filled, then
// record today's level. Each day is claimed once (DayLog.settled), so running
// this twice — even at the same moment — never penalises a day twice.
export async function settleMissedDays(today: string) {
  let player = await getOrCreatePlayer();

  const unlogged = await findUnloggedPastDays(player, today);
  if (unlogged.length > 0) {
    await prisma.dayLog.createMany({
      data: unlogged.map((date) => ({ date, level: player.level, playerId: player.id })),
      skipDuplicates: true,
    });
  }

  const unsettled = await prisma.dayLog.findMany({
    where: { playerId: player.id, date: { lt: today }, settled: false },
    orderBy: { date: 'asc' },
  });

  for (const log of unsettled) {
    await prisma.$transaction(async (tx) => {
      const claim = await tx.dayLog.updateMany({
        where: { id: log.id, settled: false },
        data: { settled: true },
      });
      if (claim.count === 0) return; // another request already settled this day

      const { start, end } = getDayRange(log.date);
      const dayTasks = await tx.task.findMany({
        where: { playerId: player.id, createdAt: { gte: start, lte: end } },
        select: { category: true },
      });
      const missing = missingSlots(log.level, dayTasks);
      const noon = new Date(start.getTime() + 12 * 60 * 60 * 1000); // within the day's range

      const missedTasks = CATEGORIES.flatMap((category) =>
        Array.from({ length: missing[category] }, () => ({
          title: `${category} task (missed)`,
          category,
          status: 'failed',
          xpGain: 0,
          xpLoss: calculateTaskXpLoss(log.level, category),
          playerId: player.id,
          createdAt: noon,
        })),
      );
      if (missedTasks.length === 0) return;

      await tx.task.createMany({ data: missedTasks });
      const xpLoss = missedXp(log.level, missing);
      const updated = await tx.player.update({
        where: { id: player.id },
        data: { xp: { increment: -xpLoss } },
      });
      const xp = Math.max(0, updated.xp);
      const level = getLevelForXp(xp);
      await tx.player.update({
        where: { id: player.id },
        data: { xp, level, title: getLevelInfo(level).title },
      });
    });
  }

  player = await prisma.player.findUniqueOrThrow({ where: { id: player.id } });

  // Record today's level for stats computation
  await prisma.dayLog.upsert({
    where: { date: today },
    create: { date: today, level: player.level, playerId: player.id },
    update: { level: player.level },
  });

  return player;
}

// --- Today's progress (read-only) ---

function countByCategory(tasks: Pick<Task, 'category'>[]) {
  return {
    total: tasks.length,
    growth: tasks.filter((t) => t.category === 'growth').length,
    hobby: tasks.filter((t) => t.category === 'hobby').length,
    self_care: tasks.filter((t) => t.category === 'self_care').length,
  };
}

// Requirements follow the player's current level, as they always have
export async function getDayProgress(player: Player, date: string) {
  const { start, end } = getDayRange(date);
  const required = getDailyRequirements(player.level);

  const dayTasks = await prisma.task.findMany({
    where: { playerId: player.id, createdAt: { gte: start, lte: end } },
    orderBy: { createdAt: 'asc' },
  });

  const completedTasks = dayTasks.filter((t) => t.status === 'completed');
  const failedTasks = dayTasks.filter((t) => t.status === 'failed');
  const xpGainedToday = completedTasks.reduce((sum, t) => sum + t.xpGain, 0);
  const xpLostToday = failedTasks.reduce((sum, t) => sum + t.xpLoss, 0);

  return {
    date,
    required,
    completed: countByCategory(completedTasks),
    failed: countByCategory(failedTasks),
    xpGainedToday,
    xpLostToday,
    xpNetToday: xpGainedToday - xpLostToday,
    tasks: dayTasks.map((t) => ({
      id: t.id,
      title: t.title,
      category: t.category,
      status: t.status,
      xpGain: t.xpGain,
      xpLoss: t.xpLoss,
    })),
  };
}
