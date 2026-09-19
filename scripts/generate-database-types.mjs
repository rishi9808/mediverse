import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

// Generate into memory first so a failed CLI call never truncates checked-in types.
const types = execFileSync('pnpm', ['exec', 'supabase', 'gen', 'types', 'typescript', '--local', '--schema', 'public'], { encoding: 'utf8' });
if (!types.includes('export type Database')) throw new Error('Supabase did not return database types');
await writeFile(new URL('../lib/database.types.ts', import.meta.url), types);
