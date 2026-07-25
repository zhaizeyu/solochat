import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

process.env.R2_PUBLIC_BASE_URL ||= 'https://uploads.test';
process.env.R2_BUCKET ||= 'solochat-test';
process.env.R2_ACCESS_KEY_ID ||= 'test-access-key';
process.env.R2_SECRET_ACCESS_KEY ||= 'test-secret-key';
process.env.S3_API_ENDPOINT ||= 'https://r2.test';
process.env.USE_LOCAL = 'true';

const { localUploadsDir, uploadToR2 } = await import('../server/config.js');
const {
  cleanupOrphanedMomentImages,
  deleteMomentImageVariants,
  deleteStoredImage,
  findOrphanedMomentImageKeys,
  localPublicUrlForObjectKey,
  objectKeyFromStoredImageUrl,
  r2PublicUrlForObjectKey
} = await import('../server/uploads.js');
import { addContact, addMoment, call, count, hasDatabase, register, state } from '../test-support/helpers.js';

const originalFetch = globalThis.fetch;
const r2Objects = new Map();

function publicUrlForObjectKey(objectKey) {
  return uploadToR2 ? r2PublicUrlForObjectKey(objectKey) : localPublicUrlForObjectKey(objectKey);
}

function installR2Mock() {
  globalThis.fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    const objectKey = decodeObjectKeyFromSignedUrl(String(url));
    if (method === 'PUT') {
      r2Objects.set(objectKey, Buffer.from(options.body || []));
      return new Response('', { status: 200 });
    }
    if (method === 'DELETE') {
      r2Objects.delete(objectKey);
      return new Response('', { status: 200 });
    }
    if (method === 'GET' && String(url).includes('list-type=2')) {
      const keys = [...r2Objects.keys()].map((key) => `<Key>${key}</Key>`).join('');
      return new Response(`<ListBucketResult>${keys}</ListBucketResult>`, { status: 200 });
    }
    if (method === 'GET') {
      if (!r2Objects.has(objectKey)) {
        return new Response('missing', { status: 404 });
      }
      return new Response(r2Objects.get(objectKey), { status: 200 });
    }
    throw new Error(`Unexpected fetch: ${method} ${url}`);
  };
}

function decodeObjectKeyFromSignedUrl(url) {
  const parsed = new URL(String(url));
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length < 2) return '';
  return decodeURIComponent(parts.slice(1).join('/'));
}

async function resetMomentStorage() {
  r2Objects.clear();
  const momentsDir = path.join(localUploadsDir, 'moments');
  if (!existsSync(momentsDir)) return;
  for (const entry of await (await import('node:fs/promises')).readdir(momentsDir)) {
    await unlink(path.join(momentsDir, entry)).catch(() => {});
  }
}

test.beforeEach(async () => {
  r2Objects.clear();
  installR2Mock();
  await resetMomentStorage();
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('deleteStoredImage removes local and optional R2 copies', async () => {
  const objectKey = 'moments/sample.jpg';
  const localPath = path.join(localUploadsDir, objectKey);
  await mkdir(path.dirname(localPath), { recursive: true });
  await writeFile(localPath, Buffer.from('local-image'));
  if (uploadToR2) r2Objects.set(objectKey, Buffer.from('remote-image'));

  const result = await deleteStoredImage(publicUrlForObjectKey(objectKey));
  assert.equal(result.objectKey, objectKey);
  assert.equal(result.r2, uploadToR2);
  assert.equal(result.local, true);
  assert.equal(r2Objects.has(objectKey), false);
  assert.equal(existsSync(localPath), false);
});

test('deleteMomentImageVariants removes alternate extensions', async () => {
  const momentId = 'abc-123';
  const pngKey = `moments/${momentId}.png`;
  const jpgKey = `moments/${momentId}.jpg`;
  const pngPath = path.join(localUploadsDir, pngKey);
  const jpgPath = path.join(localUploadsDir, jpgKey);
  await mkdir(path.dirname(pngPath), { recursive: true });
  await writeFile(pngPath, Buffer.from('png'));
  await writeFile(jpgPath, Buffer.from('jpg'));
  if (uploadToR2) {
    r2Objects.set(pngKey, Buffer.from('png'));
    r2Objects.set(jpgKey, Buffer.from('jpg'));
  }

  const deleted = await deleteMomentImageVariants(momentId, jpgKey);
  if (uploadToR2) {
    assert.ok(deleted.r2.includes(pngKey));
    assert.equal(r2Objects.has(pngKey), false);
    assert.equal(r2Objects.has(jpgKey), true);
  } else {
    assert.ok(deleted.local.includes(pngKey));
    assert.equal(existsSync(pngPath), false);
    assert.equal(existsSync(jpgPath), true);
  }
});

test('cleanupOrphanedMomentImages removes files not referenced by active moments', { skip: !hasDatabase }, async () => {
  const db = state.getDb();
  const keepKey = 'moments/keep-me.jpg';
  const orphanKey = 'moments/orphan-me.png';
  const keepPath = path.join(localUploadsDir, keepKey);
  const orphanPath = path.join(localUploadsDir, orphanKey);
  await mkdir(path.dirname(keepPath), { recursive: true });
  await writeFile(keepPath, Buffer.from('keep'));
  await writeFile(orphanPath, Buffer.from('orphan'));
  if (uploadToR2) {
    r2Objects.set(keepKey, Buffer.from('keep'));
    r2Objects.set(orphanKey, Buffer.from('orphan'));
  }

  const momentId = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO couple_moments (
      id, conversation_id, author_id, text, happened_at, image_path,
      created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    momentId,
    'a:b',
    'author',
    'keep',
    '2026-07-05',
    publicUrlForObjectKey(keepKey),
    new Date().toISOString(),
    new Date().toISOString(),
    null
  );

  const preview = await findOrphanedMomentImageKeys(db);
  assert.deepEqual(preview.orphaned, [orphanKey]);

  const cleaned = await cleanupOrphanedMomentImages(db);
  if (uploadToR2) {
    assert.deepEqual(cleaned.deletedR2, [orphanKey]);
    assert.equal(r2Objects.has(orphanKey), false);
    assert.equal(r2Objects.has(keepKey), true);
  } else {
    assert.deepEqual(cleaned.deletedLocal, [orphanKey]);
    assert.equal(existsSync(orphanPath), false);
    assert.equal(existsSync(keepPath), true);
  }

  await db.prepare('DELETE FROM couple_moments WHERE id = ?').run(momentId);
});

test('deleting or clearing a moment image removes stored files', { skip: !hasDatabase }, async () => {
  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
  const alice = await register(`mia_${suffix}`);
  const bob = await register(`mib_${suffix}`);
  await addContact(alice, bob.username);

  const imageDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z1BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const moment = await addMoment(alice, bob.id, 'with image', { imageDataUrl });
  const objectKey = objectKeyFromStoredImageUrl(moment.imageDataUrl);
  assert.ok(objectKey);
  const localPath = path.join(localUploadsDir, objectKey);
  assert.equal(existsSync(localPath), true);
  if (uploadToR2) assert.equal(r2Objects.has(objectKey), true);

  const cleared = await call(state.handleMoments, {
    method: 'PATCH',
    path: `/api/moments/items/${moment.id}`,
    user: alice,
    body: { imageDataUrl: '' }
  });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.moments[0].imageDataUrl, '');
  assert.equal(existsSync(localPath), false);
  assert.equal(r2Objects.has(objectKey), false);

  const recreated = await addMoment(alice, bob.id, 'delete image', { imageDataUrl });
  const deleteKey = objectKeyFromStoredImageUrl(recreated.imageDataUrl);
  assert.ok(deleteKey);
  const deletePath = path.join(localUploadsDir, deleteKey);
  assert.equal(existsSync(deletePath), true);

  const removed = await call(state.handleMoments, {
    method: 'DELETE',
    path: `/api/moments/items/${recreated.id}`,
    user: alice
  });
  assert.equal(removed.status, 200);
  assert.equal(existsSync(deletePath), false);
  assert.equal(r2Objects.has(deleteKey), false);
  assert.equal(await count('SELECT COUNT(*)::int AS count FROM couple_moments WHERE id = ? AND deleted_at IS NULL', recreated.id), 0);
});
