import { useState } from 'react';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { api, setToken, clearToken } from '../api/client';

interface UnlockProps {
  onUnlock: () => void;
}

// One-time screen that stores the app token on this device
export default function Unlock({ onUnlock }: UnlockProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    setChecking(true);
    setError('');
    try {
      setToken(value.trim());
      const json = await api.get('/auth/check');
      if (json.success) {
        onUnlock();
      } else {
        clearToken();
        setError('The System does not recognise you.');
      }
    } catch {
      clearToken();
      setError('Could not reach the System. Try again.');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="min-h-screen bg-void-900 flex items-center justify-center px-4">
      <Card glow="neon" className="w-full max-w-sm">
        <h1 className="text-lg font-display font-bold tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-neon-400 to-arcane-400 text-center">
          SOLO LEVELING
        </h1>
        <p className="text-xs font-mono text-gray-500 text-center mt-2 mb-6">
          Enter your access key to awaken the System.
        </p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="password"
            autoComplete="current-password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Access key"
            className="w-full bg-void-900 border border-void-600 rounded-lg px-4 py-2 text-sm font-mono text-gray-200 placeholder-gray-600 focus:outline-none focus:border-neon-500/50"
          />
          {error && <p className="text-xs font-mono text-red-400">{error}</p>}
          <Button type="submit" className="w-full" disabled={checking}>
            {checking ? 'VERIFYING...' : 'ARISE'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
