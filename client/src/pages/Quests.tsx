import { useState, useEffect, useCallback } from 'react';
import PageHeader from '../components/ui/PageHeader';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { api } from '../api/client';

interface ActiveQuest {
  id: string;
  title: string;
  status: string;
}

interface QuestData {
  date: string;
  hasQuest: boolean;
  quest: ActiveQuest | null;
  rewardXp: number;
  penaltyXp: number;
}

export default function Quests() {
  const [questData, setQuestData] = useState<QuestData | null>(null);
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState('');
  const [adding, setAdding] = useState(false);

  const fetchQuests = useCallback(async () => {
    try {
      const json = await api.get<QuestData>('/quests');
      if (json.success && json.data) setQuestData(json.data);
    } catch (err) {
      console.error('Failed to fetch quests:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQuests();
  }, [fetchQuests]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setAdding(true);
    try {
      await api.post('/quests', { title: newTitle.trim() });
      setNewTitle('');
    } catch (err) {
      console.error('Failed to add quest:', err);
    } finally {
      setAdding(false);
    }
  };

  const handleComplete = async (id: string) => {
    try {
      await api.post(`/quests/${id}/complete`);
      await fetchQuests();
    } catch (err) {
      console.error('Failed to complete quest:', err);
    }
  };

  const handleFail = async (id: string) => {
    try {
      await api.post(`/quests/${id}/fail`);
      await fetchQuests();
    } catch (err) {
      console.error('Failed to fail quest:', err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="font-mono text-gray-500 animate-pulse">Loading...</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="QUESTS" subtitle="Available Missions" />

      {/* Active Quest */}
      {questData?.hasQuest && questData.quest ? (
        <Card glow="neon" className="mb-6">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-2xl">⚡</span>
            <h4 className="text-xs font-mono text-neon-400 uppercase tracking-wider">
              Quest Available
            </h4>
          </div>
          <p className="text-lg font-display font-bold text-gray-100 mb-3">
            {questData.quest.title}
          </p>
          <div className="flex items-center gap-4 text-xs font-mono mb-4">
            <span className="text-green-400">
              +{questData.rewardXp.toLocaleString()} XP + 1 Skip Pass
            </span>
            <span className="text-gray-600">|</span>
            <span className="text-red-400">
              -{questData.penaltyXp.toLocaleString()} XP if failed
            </span>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="primary"
              size="md"
              onClick={() => handleComplete(questData.quest!.id)}
            >
              Complete Quest
            </Button>
            <Button
              variant="danger"
              size="md"
              onClick={() => handleFail(questData.quest!.id)}
            >
              Give Up
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="mb-6">
          <div className="text-center py-6">
            <span className="text-3xl mb-3 block">📜</span>
            <p className="text-sm font-mono text-gray-500">
              No quest available today.
            </p>
            <p className="text-xs font-mono text-gray-600 mt-1">
              Quests have a 10% chance of appearing each day.
            </p>
          </div>
        </Card>
      )}

      {/* Add Quest to Pool */}
      <h4 className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-3">
        Add Quest to Pool
      </h4>
      <Card>
        <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Enter a quest..."
            className="flex-1 bg-void-900 border border-void-600 rounded-lg px-4 py-2 text-sm font-mono text-gray-200 placeholder-gray-600 focus:outline-none focus:border-neon-500/50"
          />
          <Button type="submit" variant="secondary" size="md" disabled={adding || !newTitle.trim()}>
            {adding ? 'Adding...' : 'Add'}
          </Button>
        </form>
        <p className="text-[10px] font-mono text-gray-600 mt-2">
          Added quests are stored in your pool and may randomly appear on future days.
        </p>
      </Card>
    </div>
  );
}
