import { Link, useLocation } from 'react-router-dom';

export default function Header({ totalVotes }: { totalVotes: number }) {
  const location = useLocation();

  const navLink = (to: string, label: string) => {
    const active = location.pathname === to;
    return (
      <Link
        to={to}
        className={`text-sm no-underline px-3 py-1.5 rounded-lg transition-colors ${
          active
            ? 'bg-[#B31B1B]/15 text-[#e8534f] font-medium'
            : 'text-[#8a8490] hover:text-[#c8c4cc]'
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <header className="border-b border-white/[0.06] bg-[#110e14]/80 backdrop-blur-md sticky top-0 z-50">
      <div className="max-w-5xl mx-auto px-5 py-3 flex items-center justify-between">
        <Link to="/" className="text-lg font-bold no-underline text-[#f0ece8] tracking-tight">
          <span className="text-[#B31B1B]">Cornell</span>ClubRank
        </Link>
        <nav className="flex items-center gap-1">
          {navLink('/', 'Vote')}
          {navLink('/leaderboard', 'Rankings')}
          {navLink('/about', 'About')}
          {totalVotes > 0 && (
            <span className="text-xs text-[#5a5660] ml-3 tabular-nums">
              {totalVotes.toLocaleString()} votes
            </span>
          )}
        </nav>
      </div>
    </header>
  );
}
