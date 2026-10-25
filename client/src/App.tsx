import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Quests from './pages/Quests';
import Profile from './pages/Profile';
import Unlock from './pages/Unlock';
import { AUTH_REQUIRED_EVENT, getToken } from './api/client';

function App() {
  const [unlocked, setUnlocked] = useState(() => getToken() !== null);

  useEffect(() => {
    const lock = () => setUnlocked(false);
    window.addEventListener(AUTH_REQUIRED_EVENT, lock);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, lock);
  }, []);

  if (!unlocked) {
    return <Unlock onUnlock={() => setUnlocked(true)} />;
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
