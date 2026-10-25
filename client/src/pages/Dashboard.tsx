import { useState } from 'react';
import { usePlayer } from '../hooks/usePlayer';
import { useDaily } from '../hooks/useDaily';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import PageHeader from '../components/ui/PageHeader';
import PlayerBanner from '../components/ui/PlayerBanner';
import { TASK_CATEGORIES, getTodayDate } from '@solo-leveling/shared';
import type { TaskCategory } from '@solo-leveling/shared';

const categoryStyles: Record<TaskCategory, { icon: string; color: string; glowColor: string }> = {
  growth: { icon: '🌱', color: 'text-green-400', glowColor: 'border-green-500/20' },
  hobby: { icon: '🎮', color: 'text-blue-400', glowColor: 'border-blue-500/20' },
  self_care: { icon: '💪', color: 'text-rose-400', glowColor: 'border-rose-500/20' },
};

export default function Dashboard() {
  const { player, loading: playerLoading, refetch: refetchPlayer } = usePlayer();
  const { daily, loading: dailyLoading, markTask, unmarkTask, refetch: refetchDaily } = useDaily();
  // subtitles keyed by `${category}-${slotIndex}`, persisted to localStorage for the current day
  const todayKey = `subtitles_${getTodayDate()}`;
  const [subtitles, setSubtitles] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem(todayKey) ?? '{}');
    } catch {
      return {};
    }
  });

  const updateSubtitles = (next: Record<string, string>) => {
    setSubtitles(next);
    localStorage.setItem(todayKey, JSON.stringify(next));
  };

  const loading = playerLoading || dailyLoading;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="font-mono text-gray-500 animate-pulse">Loading system...</p>
      </div>
    );
  }

  if (!player || !daily) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="font-mono text-red-400">System error: Player not found</p>
      </div>
    );
  }

  const handleMark = async (category: TaskCategory, done: boolean, slotKey: string) => {
    const subtitle = subtitles[slotKey];
    await markTask(category, done, subtitle);
    updateSubtitles(Object.fromEntries(Object.entries(subtitles).filter(([k]) => k !== slotKey)));
    await refetchPlayer();
  };

  const handleUnmark = async (taskId: string) => {
    await unmarkTask(taskId);
    await refetchPlayer();
  };

  const handleSkip = async (category: TaskCategory) => {
    try {
      await fetch('/api/daily/skip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category }),
      });
      await refetchDaily();
      await refetchPlayer();
    } catch (err) {
      console.error('Failed to skip task:', err);
    }
  };

  const categories: TaskCategory[] = ['growth', 'hobby', 'self_care'];

  return (
    <div>
      <PageHeader title="DASHBOARD" subtitle="Hunter Status Overview" />

      {/* Player Banner */}
      <PlayerBanner
        name={player.name}
        rank={player.rank}
        title={player.title}
        xp={player.xp}
        xpToEnter={player.xpToEnter}
        xpToPass={player.xpToPass}
        className="mb-6"
      />

      {/* Today's XP Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Card>
          <div className="text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-1">
            Challenges Today
          </div>
          <div className="text-2xl font-display font-bold text-gray-100">
            {daily.completed.total + daily.failed.total}
            <span className="text-sm text-gray-500 font-mono">/{daily.required.total}</span>
          </div>
        </Card>
        <Card>
          <div className="text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-1">
            XP Earned
          </div>
          <div className={`text-2xl font-display font-bold ${daily.xpGainedToday > 0 ? 'text-green-400' : 'text-gray-500'}`}>
            +{daily.xpGainedToday.toLocaleString()}
          </div>
        </Card>
        <Card>
          <div className="text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-1">
            XP Lost
          </div>
          <div className={`text-2xl font-display font-bold ${daily.xpLostToday > 0 ? 'text-red-400' : 'text-gray-500'}`}>
            {daily.xpLostToday > 0 ? `-${daily.xpLostToday.toLocaleString()}` : '0'}
          </div>
        </Card>
        <Card>
          <div className="text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-1">
            Skip Passes
          </div>
          <div className={`text-2xl font-display font-bold ${player.skipPasses > 0 ? 'text-arcane-400' : 'text-gray-500'}`}>
            {player.skipPasses}
          </div>
        </Card>
      </div>

      {/* Category Task Cards */}
      <h4 className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-3">
        Daily Challenges
      </h4>
      <div className="space-y-4">
        {categories.map((cat) => {
          const info = TASK_CATEGORIES[cat];
          const style = categoryStyles[cat];
          const required = daily.required[cat];
          const completed = daily.completed[cat];
          const failed = daily.failed[cat];
          const catTasks = daily.tasks.filter((t) => t.category === cat);
          const marked = completed + failed;
          const remaining = Math.max(0, required - marked);

          if (required === 0) return null;

          return (
            <Card key={cat} className={`border ${style.glowColor}`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{style.icon}</span>
                  <div>
                    <h4 className={`text-sm font-display font-bold ${style.color}`}>
                      {info.label}
                    </h4>
                    <p className="text-[10px] font-mono text-gray-500">{info.description}</p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-display font-bold text-gray-200">
                    {marked}<span className="text-gray-500">/{required}</span>
                  </div>
                  <p className="text-[10px] font-mono text-gray-600">slots filled</p>
                </div>
              </div>

              {/* Task Slots */}
              <div className="space-y-2">
                {/* Marked slots (completed + failed) with undo */}
                {catTasks.map((task) => (
                  <div
                    key={task.id}
                    className={`flex items-center justify-between rounded-lg px-4 py-2 ${
                      task.status === 'completed'
                        ? 'bg-green-500/5 border border-green-500/10'
                        : 'bg-red-500/5 border border-red-500/10'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={task.status === 'completed' ? 'text-green-400 text-sm' : 'text-red-400 text-sm'}>
                        {task.status === 'completed' ? '✓' : '✗'}
                      </span>
                      <span className={`text-sm font-mono truncate ${task.status === 'completed' ? 'text-green-400' : 'text-red-400'}`}>
                        {task.title}
                      </span>
                      <span className={`text-xs font-mono shrink-0 ${task.status === 'completed' ? 'text-green-400/60' : 'text-red-400/60'}`}>
                        {task.status === 'completed' ? `+${task.xpGain}` : `-${task.xpLoss}`} XP
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleUnmark(task.id)}
                    >
                      Undo
                    </Button>
                  </div>
                ))}

                {/* Remaining slots */}
                {Array.from({ length: remaining }).map((_, i) => {
                  const slotKey = `${cat}-${marked + i}`;
                  return (
                    <div
                      key={`pending-${i}`}
                      className="bg-void-900 border border-void-600 rounded-lg px-4 py-2 space-y-2"
                    >
                      <input
                        type="text"
                        value={subtitles[slotKey] ?? ''}
                        onChange={(e) => updateSubtitles({ ...subtitles, [slotKey]: e.target.value })}
                        placeholder={`${info.label} Task ${marked + i + 1} — add subtitle...`}
                        className="w-full bg-transparent text-sm font-mono text-gray-300 placeholder-gray-600 focus:outline-none"
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="success"
                          size="sm"
                          onClick={() => handleMark(cat, true, slotKey)}
                        >
                          CLEARED
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => handleMark(cat, false, slotKey)}
                        >
                          GIVE UP
                        </Button>
                        {player.skipPasses > 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleSkip(cat)}
                            className="text-arcane-400"
                          >
                            Skip
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
