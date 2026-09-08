import { useState, useEffect, useCallback, useRef } from 'react';
import type { Club } from '../lib/api';
import { getMatchup, submitVote, getStats } from '../lib/api';
import ClubCard from './ClubCard';

export default function Matchup() {
  const [clubs, setClubs] = useState<Club[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [voting, setVoting] = useState(false);
  const [animKey, setAnimKey] = useState(0);
  const lastIds = useRef<number[]>([]);
  const matchupToken = useRef<string>('');

  const loadMatchup = useCallback(async (excludeIds?: number[]) => {
    setLoading(true);
    try {
      const result = await getMatchup(category || undefined, excludeIds);
      setClubs(result.clubs);
      matchupToken.current = result.token;
      lastIds.current = result.clubs.map((c) => c.id);
      setAnimKey((k) => k + 1);
    } catch (e) {
      console.error('Failed to load matchup', e);
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => {
    getStats().then((s) => setCategories(s.categories));
  }, []);

  useEffect(() => {
    lastIds.current = [];
    loadMatchup();
  }, [loadMatchup]);

  const handleVote = async (winnerId: number, loserId: number) => {
    if (voting) return;
    setVoting(true);
    try {
      await submitVote(winnerId, loserId, matchupToken.current);
      await loadMatchup(lastIds.current);
    } finally {
      setVoting(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-6 sm:gap-10 px-3 sm:px-4 pt-8 sm:pt-14 pb-16">
      <div className="text-center">
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white mb-2">
          which club is better?
        </h1>
        <p className="text-[#6a6570] text-sm">
          pick one. elo does the rest.
        </p>
      </div>

      <select
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        className="bg-[#1c1820] border border-white/[0.08] rounded-lg px-4 py-2 text-sm text-[#c8c4cc] outline-none hover:border-white/[0.14] transition-colors"
      >
        <option value="">All Categories</option>
        {categories.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      {loading ? (
        <div className="text-[#5a5660] py-20 text-sm">Loading...</div>
      ) : clubs.length < 2 ? (
        <div className="text-[#5a5660] py-20 text-sm">Not enough clubs in this category</div>
      ) : (
        <div
          key={animKey}
          className="fade-in grid grid-cols-[1fr_auto_1fr] sm:grid-cols-[320px_auto_320px] items-stretch justify-items-center gap-2 sm:gap-8 w-full sm:w-auto"
        >
          <ClubCard
            club={clubs[0]}
            onClick={() => handleVote(clubs[0].id, clubs[1].id)}
          />
          <div className="self-center text-xs sm:text-base font-extrabold tracking-wide text-[#B31B1B] bg-[#B31B1B]/10 border border-[#B31B1B]/20 rounded-full w-8 h-8 sm:w-11 sm:h-11 flex items-center justify-center shrink-0">
            vs
          </div>
          <ClubCard
            club={clubs[1]}
            onClick={() => handleVote(clubs[1].id, clubs[0].id)}
          />
        </div>
      )}
    </div>
  );
}
