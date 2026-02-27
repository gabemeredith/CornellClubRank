import { Link } from 'react-router-dom';

export default function About() {
  return (
    <div className="max-w-md mx-auto px-5 pt-28 pb-16 text-center">
      <div className="space-y-5">
        <h1 className="text-2xl font-extrabold tracking-tight text-white">
          <span className="text-[#B31B1B]">Cornell</span>ClubMash
        </h1>

        <p className="text-[#8a8490] text-sm leading-relaxed">
          hot or not but for cornell clubs
        </p>

        <p className="text-[#8a8490] text-sm leading-relaxed">
          pick the better club. elo does the rest.
        </p>

        <p className="text-[#8a8490] text-sm leading-relaxed">
          no login. completely anonymous.
        </p>

        <p className="text-[#5a5660] text-sm leading-relaxed">
          not affiliated with cornell lol
        </p>

        <div className="pt-3">
          <Link
            to="/"
            className="inline-block bg-[#B31B1B] text-white text-sm font-medium px-6 py-2.5 rounded-lg no-underline hover:bg-[#cc2020] transition-colors"
          >
            vote
          </Link>
        </div>
      </div>
    </div>
  );
}
