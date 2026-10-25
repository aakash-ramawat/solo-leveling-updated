// One-time copy of the old local SQLite database (solo.db) into Postgres.
//
// Usage (from the repo root, with DATABASE_URL pointing at the new database):
//   npm run db:import -- /path/to/solo.db
//   npm run db:import -- /path/to/solo.db --replace   # wipe the target first
//
// Reads the SQLite file with the `sqlite3` command-line tool (built into macOS),
// so the old file is never modified.
import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type Row = Record<string, unknown>;

function readTable(dbPath: string, table: string): Row[] {
  const out = execFileSync('sqlite3', ['-readonly', '-json', dbPath, `SELECT * FROM "${table}"`], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  return out.trim() ? (JSON.parse(out) as Row[]) : [];
}

// Prisma's SQLite driver stores DateTime as epoch milliseconds; SQLite's own
// CURRENT_TIMESTAMP default writes "YYYY-MM-DD HH:MM:SS" in UTC.
function toDate(value: unknown): Date {
  if (typeof value === 'number') return new Date(value);
  const s = String(value);
  if (/^\d+$/.test(s)) return new Date(Number(s));
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(s)) return new Date(s.replace(' ', 'T') + 'Z');
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new Error(`Unrecognised date value: ${s}`);
  return d;
}

function toOptionalDate(value: unknown): Date | null {
  return value === null || value === undefined ? null : toDate(value);
}

async function main() {
  const args = process.argv.slice(2);
  const replace = args.includes('--replace');
  const dbPath = args.find((a) => !a.startsWith('--'));

  if (!dbPath || !existsSync(dbPath)) {
    console.error('Usage: npm run db:import -- /path/to/solo.db [--replace]');
    process.exit(1);
  }

  const players = readTable(dbPath, 'Player');
  const dayLogs = readTable(dbPath, 'DayLog');
  const tasks = readTable(dbPath, 'Task');
  const quests = readTable(dbPath, 'Quest');
  const activeQuests = readTable(dbPath, 'ActiveQuest');

  const existing = await prisma.player.count();
  if (existing > 0 && !replace) {
    console.error('The target database already has data. Re-run with --replace to wipe it and import.');
    process.exit(1);
  }

  await prisma.$transaction(async (tx) => {
    if (replace) {
      await tx.task.deleteMany();
      await tx.activeQuest.deleteMany();
      await tx.quest.deleteMany();
      await tx.dayLog.deleteMany();
      await tx.player.deleteMany();
    }

    await tx.player.createMany({
      data: players.map((p) => ({
        id: String(p.id),
        name: String(p.name),
        title: String(p.title),
        level: Number(p.level),
        xp: Number(p.xp),
        skipPasses: Number(p.skipPasses ?? 0),
        createdAt: toDate(p.createdAt),
        updatedAt: toDate(p.updatedAt),
      })),
    });

    await tx.dayLog.createMany({
      data: dayLogs.map((d) => ({
        id: String(d.id),
        date: String(d.date),
        level: Number(d.level),
        playerId: String(d.playerId),
      })),
    });

    await tx.quest.createMany({
      data: quests.map((q) => ({
        id: String(q.id),
        title: String(q.title),
        playerId: String(q.playerId),
        createdAt: toDate(q.createdAt),
      })),
    });

    await tx.activeQuest.createMany({
      data: activeQuests.map((a) => ({
        id: String(a.id),
        date: String(a.date),
        questId: a.questId === null ? null : String(a.questId),
        title: a.title === null ? null : String(a.title),
        status: String(a.status),
        playerId: String(a.playerId),
      })),
    });

    await tx.task.createMany({
      data: tasks.map((t) => ({
        id: String(t.id),
        title: String(t.title),
        description: String(t.description ?? ''),
        category: String(t.category),
        status: String(t.status),
        xpGain: Number(t.xpGain),
        xpLoss: Number(t.xpLoss),
        playerId: String(t.playerId),
        createdAt: toDate(t.createdAt),
        completedAt: toOptionalDate(t.completedAt),
      })),
    });
  }, { timeout: 120_000 });

  console.log(
    `Imported ${players.length} player(s), ${dayLogs.length} day log(s), ${tasks.length} task(s), ` +
    `${quests.length} quest(s), ${activeQuests.length} active quest roll(s).`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
