#!/usr/bin/env node
import { cleanupOrphanedMomentImages, findOrphanedMomentImageKeys } from '../server/uploads.js';
import { openDb, getDb, closeDb } from '../server/db.js';
import { assertRuntimeConfig } from '../server/config.js';

const dryRun = process.argv.includes('--dry-run');

assertRuntimeConfig();
await openDb();

const preview = await findOrphanedMomentImageKeys(getDb());
console.log(`Active moment images kept: ${preview.keepKeys.length}`);
for (const key of preview.keepKeys) {
  console.log(`  keep ${key}`);
}

console.log(`Orphaned moment images found: ${preview.orphaned.length}`);
for (const key of preview.orphaned) {
  console.log(`  orphan ${key}`);
}

if (dryRun) {
  console.log('Dry run only; no files deleted.');
  await closeDb?.();
  process.exit(0);
}

if (preview.orphaned.length === 0) {
  await closeDb?.();
  process.exit(0);
}

const result = await cleanupOrphanedMomentImages(getDb());
console.log(`Deleted from R2: ${result.deletedR2.length}`);
for (const key of result.deletedR2) {
  console.log(`  r2 ${key}`);
}
console.log(`Deleted from local: ${result.deletedLocal.length}`);
for (const key of result.deletedLocal) {
  console.log(`  local ${key}`);
}

await closeDb?.();
