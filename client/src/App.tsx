import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Quests from './pages/Quests';
import Profile from './pages/Profile';
import Unlock from './pages/Unlock';
import { getTodayDate } from '@solo-leveling/shared';
import { AUTH_REQUIRED_EVENT, api, getToken } from './api/client';

function App() {
  const [unlocked, setUnlocked] = useState(() => getToken() !== null);
  const [syncedDate, setSyncedDate] = useState<string | null>(null);

  useEffect(() => {
    const lock = () => setUnlocked(false);
    window.addEventListener(AUTH_REQUIRED_EVENT, lock);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, lock);
  }, []);

  // Settle missed days and start today once per app open, before any page reads
  useEffect(() => {
    if (!unlocked) return;
    const today = getTodayDate();
    api
      .post('/daily/sync')
      .catch((err) => console.error('Failed to sync day:', err))
      .finally(() => setSyncedDate(today));
  }, [unlocked]);

  // A home-screen app can stay open overnight — start fresh when the day has changed
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && syncedDate && syncedDate !== getTodayDate()) {
        window.location.reload();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [syncedDate]);

  if (!unlocked) {
    return <Unlock onUnlock={() => setUnlocked(true)} />;
  }

  if (!syncedDate) {
    return (
      <div className="min-h-screen bg-void-900 flex items-center justify-center">
        <p className="font-mono text-gray-500 animate-pulse">Loading system...</p>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/quests" element={<Quests />} />
          <Route path="/profile" element={<Profile />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
