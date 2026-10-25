import { useEffect, useState } from 'react';
import type { Player } from '@solo-leveling/shared';
import { api } from '../api/client';

export function usePlayer() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchPlayer = async () => {
    try {
      const json = await api.get<Player>('/player');
      if (json.success && json.data) setPlayer(json.data);
    } catch (err) {
      console.error('Failed to fetch player:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPlayer();
  }, []);

  return { player, loading, refetch: fetchPlayer };
}
