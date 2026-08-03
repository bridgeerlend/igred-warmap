/**
 * Publishes one morning's Brief.
 *
 * The edition is entirely sourced material, so it publishes directly — the approval flow in
 * the brief applies to authored prose, not to records that point at their own sources.
 *
 * Run: npm run edition [-- --date 2026-08-03] [-- --force]
 */
import { buildEdition, EditionAlreadyPublished } from '../edition/build.js';
import { loadConfig } from '../config.js';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};

const now = new Date().toISOString();
const date = flag('date') ?? now.slice(0, 10);
const force = args.includes('--force');

try {
  const { edition, path } = buildEdition({
    date,
    now,
    leadCount: loadConfig().brief.leadCount,
    force,
  });

  const themes = edition.sections.flatMap((section) => section.themes.length);
  console.log(
    `Edition ${edition.date}: ${edition.stories.length} stories, ${edition.sections.length} sections, ${themes.reduce((a, b) => a + b, 0)} themes`,
  );
  console.log(`  leads offered for drafting: ${edition.leadStoryIds.length}`);
  console.log(`  from ${edition.articlesConsidered} articles across ${edition.feedsOk}/${edition.feedsTotal} feeds`);
  console.log(`  written to ${path}`);
} catch (error) {
  if (error instanceof EditionAlreadyPublished) {
    // Not a failure: the scheduled run simply has nothing to do today.
    console.log(error.message);
    process.exitCode = 0;
  } else {
    throw error;
  }
}
