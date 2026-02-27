import { readFileSync } from 'fs';
import { resolve } from 'path';

interface Club {
  name: string;
  url: string;
  logo_url: string;
  has_logo: boolean;
  group_type: string;
  logo_file: string;
}

const clubs: Club[] = JSON.parse(
  readFileSync(resolve(__dirname, '../cornell_clubs.json'), 'utf-8')
);

// Generate SQL INSERT statements
const lines: string[] = [];
lines.push('DELETE FROM clubs;');

for (const club of clubs) {
  const name = club.name.replace(/'/g, "''");
  const url = (club.url || '').trim().replace(/'/g, "''");
  const logoUrl = (club.logo_url || '').replace(/'/g, "''");
  // Extract just the filename from the path like "./club_logos/Name.png"
  const logoFile = club.has_logo && club.logo_file
    ? club.logo_file.replace('./club_logos/', '')
    : '';
  const groupType = club.group_type.replace(/'/g, "''");

  lines.push(
    `INSERT INTO clubs (name, url, logo_url, logo_file, group_type) VALUES ('${name}', '${url}', '${logoUrl}', '${logoFile}', '${groupType}');`
  );
}

// Write to a SQL file that can be executed with wrangler
const output = lines.join('\n');
const outputPath = resolve(__dirname, 'seed.sql');
require('fs').writeFileSync(outputPath, output, 'utf-8');
console.log(`Wrote ${clubs.length} club inserts to seed.sql`);
