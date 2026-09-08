import { useCallback, useEffect, useRef, useState } from 'react';
import type { Club } from '../lib/api';
import { getLeaderboard, getStats, logoUrl } from '../lib/api';

const PAGE_SIZE = 25;

function getInitials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

export default function Leaderboard() {
  const [clubs, setClubs] = useState<Club[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState<string>('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // Identifies the current filter combination, so a slow "load more" response
  // belonging to an older filter can't be appended to a newer list.
  const queryKey = `${category} ${debouncedSearch}`;
  const queryKeyRef = useRef(queryKey);
  queryKeyRef.current = queryKey;

  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    getStats().then((s) => setCategories(s.categories));
  }, []);

  // Debounce typing so we don't fire a request per keystroke
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(id);
  }, [search]);

  // First page whenever the filters change
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    getLeaderboard(
      {
        category: category || undefined,
        search: debouncedSearch || undefined,
        limit: PAGE_SIZE,
        offset: 0,
      },
      controller.signal
    )
      .then((page) => {
        setClubs(page.clubs);
        setTotal(page.total);
        setHasMore(page.hasMore);
        setLoading(false);
      })
      .catch((err) => {
        if (err?.name !== 'AbortError') setLoading(false);
      });
    return () => controller.abort();
  }, [category, debouncedSearch]);

  const loadMore = useCallback(() => {
    if (loading || loadingMore || !hasMore) return;
    const offset = clubs.length;
    const keyAtCall = queryKey;
    setLoadingMore(true);
    getLeaderboard({
      category: category || undefined,
      search: debouncedSearch || undefined,
      limit: PAGE_SIZE,
      offset,
    })
      .then((page) => {
        if (queryKeyRef.current !== keyAtCall) return;
        setClubs((prev) => [...prev, ...page.clubs]);
        setTotal(page.total);
        setHasMore(page.hasMore);
      })
      .catch(() => {})
      .finally(() => {
        if (queryKeyRef.current === keyAtCall) setLoadingMore(false);
      });
  }, [category, clubs.length, debouncedSearch, hasMore, loading, loadingMore, queryKey]);

  // Auto-load the next page as the sentinel scrolls into view
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: '300px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  return (
    <div className="max-w-3xl mx-auto px-5 pt-10 pb-16">
      <h1 className="text-2xl font-extrabold tracking-tight text-white mb-8 text-center">
        rankings
      </h1>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="flex gap-1.5 flex-wrap">
          <button
            onClick={() => setCategory('')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
              !category
                ? 'bg-white/10 border-white/10 text-white'
                : 'bg-transparent border-white/[0.06] text-[#6a6570] hover:text-[#a8a4ac] hover:border-white/10'
            }`}
          >
            All
          </button>
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                category === c
                  ? 'bg-white/10 border-white/10 text-white'
                  : 'bg-transparent border-white/[0.06] text-[#6a6570] hover:text-[#a8a4ac] hover:border-white/10'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-[#1c1820] border border-white/[0.06] rounded-lg px-3 py-1.5 text-sm text-[#c8c4cc] outline-none placeholder-[#4a4650] sm:ml-auto focus:border-white/[0.12] transition-colors w-full sm:w-40"
        />
      </div>

      {loading && clubs.length === 0 ? (
        <div className="text-[#5a5660] text-center py-20 text-sm">Loading...</div>
      ) : clubs.length === 0 ? (
        <div className="text-[#5a5660] text-center py-20 text-sm">No clubs found.</div>
      ) : (
        <>
          <div
            className={`bg-[#1c1820] border border-white/[0.06] rounded-xl overflow-hidden transition-opacity ${
              loading ? 'opacity-50' : 'opacity-100'
            }`}
          >
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.04] text-[#5a5660] text-xs uppercase tracking-wider">
                  <th className="px-3 sm:px-4 py-3 text-left w-12 font-medium">#</th>
                  <th className="px-3 sm:px-4 py-3 text-left font-medium">Club</th>
                  <th className="px-3 sm:px-4 py-3 text-right font-medium">Elo</th>
                  <th className="px-3 sm:px-4 py-3 text-right hidden sm:table-cell font-medium">Win %</th>
                </tr>
              </thead>
              <tbody>
                {clubs.map((club, i) => (
                  <tr
                    key={club.id}
                    className="border-t border-white/[0.03] hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="px-3 sm:px-4 py-3 text-[#4a4650] font-mono text-xs">{i + 1}</td>
                    <td className="px-3 sm:px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 overflow-hidden bg-[#d0cdd4] border border-[#b8b5bc] flex items-center justify-center shrink-0">
                          {club.logo_file ? (
                            <img
                              src={logoUrl(club.logo_file)}
                              alt=""
                              loading="lazy"
                              className="w-full h-full object-contain"
                            />
                          ) : (
                            <span className="text-[10px] font-bold text-[#9a96a0]">
                              {getInitials(club.name)}
                            </span>
                          )}
                        </div>
                        <div>
                          <div className="font-medium text-[#e8e4ec]">{club.name}</div>
                          <div className="text-[11px] text-[#5a5660]">{club.group_type}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 sm:px-4 py-3 text-right font-mono font-semibold text-white tabular-nums">
                      {Math.round(club.elo)}
                    </td>
                    <td className="px-3 sm:px-4 py-3 text-right text-[#5a5660] hidden sm:table-cell tabular-nums text-xs">
                      {club.wins + club.losses > 0
                        ? `${Math.round((club.wins / (club.wins + club.losses)) * 100)}%`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div ref={sentinelRef} className="pt-5 text-center">
            {hasMore ? (
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="px-4 py-2 rounded-lg text-xs font-medium border border-white/[0.06] text-[#6a6570] hover:text-[#a8a4ac] hover:border-white/10 transition-all disabled:opacity-50"
              >
                {loadingMore ? 'Loading...' : `Load more (${clubs.length} of ${total})`}
              </button>
            ) : (
              <div className="text-[11px] text-[#4a4650]">
                {total} club{total === 1 ? '' : 's'}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
