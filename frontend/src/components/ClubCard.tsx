import type { Club } from '../lib/api';
import { logoUrl } from '../lib/api';

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

export default function ClubCard({
  club,
  onClick,
}: {
  club: Club;
  onClick: () => void;
}) {
  const hasLogo = !!club.logo_file;

  return (
    <div
      className="club-card bg-[#1c1820] rounded-xl sm:rounded-2xl p-3 sm:p-8 flex flex-col items-center gap-3 sm:gap-5 w-full max-w-[320px] h-full border border-white/[0.06]"
      onClick={onClick}
    >
      <div className="w-16 h-16 sm:w-32 sm:h-32 overflow-hidden bg-[#d0cdd4] border border-[#b8b5bc] flex items-center justify-center shrink-0">
        {hasLogo ? (
          <img
            src={logoUrl(club.logo_file)}
            alt={club.name}
            className="w-full h-full object-contain p-1.5"
            loading="eager"
          />
        ) : (
          <span className="text-xl font-bold text-[#9a96a0]">
            {getInitials(club.name)}
          </span>
        )}
      </div>
      <h3 className="text-center text-[13px] sm:text-sm font-semibold leading-snug text-[#e8e4ec] sm:min-h-[2.5rem] flex items-center">
        {club.name}
      </h3>
      <span className="mt-auto text-[10px] sm:text-[11px] font-medium px-2 sm:px-2.5 py-1 rounded-full bg-white/[0.04] text-[#7a7580] text-center">
        {club.group_type}
      </span>
    </div>
  );
}
