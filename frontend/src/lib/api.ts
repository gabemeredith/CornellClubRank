const BASE = '';

export interface Club {
  id: number;
  name: string;
  logo_file: string;
  group_type: string;
  elo: number;
  wins: number;
  losses: number;
}

export interface Stats {
  totalVotes: number;
  totalClubs: number;
  topClub: { name: string; elo: number } | null;
  categories: string[];
}

export interface MatchupResult {
  clubs: Club[];
  token: string;
}

export async function getMatchup(category?: string, excludeIds?: number[]): Promise<MatchupResult> {
  const params = new URLSearchParams();
  if (category) params.set('category', category);
  if (excludeIds?.length) params.set('exclude', excludeIds.join(','));
  const qs = params.toString();
  const res = await fetch(`${BASE}/api/matchup${qs ? '?' + qs : ''}`);
  const data = await res.json();
  return { clubs: data.clubs, token: data.token };
}

export async function submitVote(winnerId: number, loserId: number, token: string) {
  const res = await fetch(`${BASE}/api/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ winnerId, loserId, token }),
  });
  return res.json();
}

export async function getLeaderboard(category?: string): Promise<Club[]> {
  const params = category ? `?category=${encodeURIComponent(category)}` : '';
  const res = await fetch(`${BASE}/api/leaderboard${params}`);
  const data = await res.json();
  return data.clubs;
}

export async function getStats(): Promise<Stats> {
  const res = await fetch(`${BASE}/api/stats`);
  return res.json();
}

export function logoUrl(logoFile: string): string {
  if (!logoFile) return '';
  return `/logos/${logoFile}`;
}
