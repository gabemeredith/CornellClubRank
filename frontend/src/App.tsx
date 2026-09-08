import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Header from './components/Header';
import Matchup from './components/Matchup';
import Leaderboard from './components/Leaderboard';
import About from './components/About';
import { getStats } from './lib/api';

function App() {
  const [totalVotes, setTotalVotes] = useState(0);

  useEffect(() => {
    // The stats endpoint serves a snapshot that can be up to a minute stale, so
    // never let a poll move the counter backwards past an optimistic bump.
    const poll = () =>
      getStats().then((s) => setTotalVotes((v) => Math.max(v, s.totalVotes))).catch(() => {});
    poll();
    const id = setInterval(poll, 10000);
    return () => clearInterval(id);
  }, []);

  return (
    <BrowserRouter>
      <div className="min-h-screen">
        <Header totalVotes={totalVotes} />
        <Routes>
          <Route
            path="/"
            element={
              <Matchup
                totalVotes={totalVotes}
                onVoted={() => setTotalVotes((v) => v + 1)}
              />
            }
          />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/about" element={<About />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
