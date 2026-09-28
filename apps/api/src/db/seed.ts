import { newId } from '@shade/shared';
import { closePool, query } from './client.js';
import { hashPassword } from '../auth/password.js';

/**
 * Development seed.
 *
 * Creates one demo account with a project and a small activity trail, so the
 * dashboard has something in it on first run. It writes no documents: documents
 * are created by uploading, and a seeded document with no bytes behind it would
 * be a row pointing at storage that does not exist — exactly the phantom state
 * the upload ticket flow exists to prevent.
 *
 * Idempotent: re-running updates the password rather than failing on the unique
 * email, so the credentials in the README stay true.
 */

const DEMO_EMAIL = 'demo@shade.dev';
const DEMO_PASSWORD = 'shade-demo-2025';
const DEMO_NAME = 'Demo User';

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed a production database.');
  }

  console.log('Seeding development data…');

  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const user = await query<{ id: string }>(
    `INSERT INTO users (id, email, name, password_hash)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE
       SET name = EXCLUDED.name,
           password_hash = EXCLUDED.password_hash,
           updated_at = now()
     RETURNING id`,
    [newId('user'), DEMO_EMAIL, DEMO_NAME, passwordHash],
  );

  const userId = user.rows[0]?.id;
  if (!userId) throw new Error('Seed could not create the demo user.');

  // A project is created only if this user has none, so re-running the seed
  // does not accumulate duplicates.
  const existing = await query<{ count: string }>(
    'SELECT count(*) AS count FROM projects WHERE user_id = $1',
    [userId],
  );

  if (Number(existing.rows[0]?.count ?? 0) === 0) {
    const project = await query<{ id: string }>(
      `INSERT INTO projects (id, user_id, name, summary)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [
        newId('project'),
        userId,
        'Annual reports',
        'Year-end filings processed into Markdown and structured JSON.',
      ],
    );

    const projectId = project.rows[0]?.id;
    if (projectId) {
      await query(
        `INSERT INTO activities (id, user_id, project_id, type, message)
         VALUES ($1, $2, $3, 'PROJECT_CREATED', $4)`,
        [newId('activity'), userId, projectId, 'Created project Annual reports'],
      );
    }
    console.log('  • project "Annual reports" created');
  } else {
    console.log('  • demo user already has projects; left untouched');
  }

  console.log(`\nDemo account ready:\n  email:    ${DEMO_EMAIL}\n  password: ${DEMO_PASSWORD}\n`);
}

main()
  .then(() => closePool())
  .catch(async (error: unknown) => {
    console.error('Seed failed:', error instanceof Error ? error.message : error);
    await closePool();
    process.exit(1);
  });
