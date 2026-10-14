import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createNotesAuthenticator } from '../src/notes-auth.mjs';
import { diffPolicy, loadSnapshot, restorePolicyVersion, restoreSingleNote } from '../src/restore.mjs';

const authenticate = createNotesAuthenticator();

function readDataFile(dataPath) {
  try {
    const raw = readFileSync(dataPath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && Array.isArray(parsed.notes) ? parsed : { notes: [] };
  } catch {
    return { notes: [] };
  }
}

function writeDataFile(dataPath, data) {
  writeFileSync(dataPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return data;
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  const auth = await authenticate(request);
  if (auth.error) return response.status(auth.status).json({ error: auth.error });

  const body = request.body && typeof request.body === 'object' ? request.body : {};
  const mode = typeof body.mode === 'string' ? body.mode : 'note';

  if (mode === 'policy') {
    const snapshot = loadSnapshot(resolve(process.cwd(), 'restore-backup.json'));
    const currentPolicy = JSON.parse(readFileSync(resolve(process.cwd(), 'aleph.config.json'), 'utf8'));
    const result = restorePolicyVersion(currentPolicy, snapshot.policy);
    const drift = diffPolicy(currentPolicy, snapshot.policy);
    if (!result.applied) {
      return response.status(200).json({ ok: true, mode: 'policy', restored: false, diff: drift });
    }
    writeFileSync(resolve(process.cwd(), 'aleph.config.json'), `${JSON.stringify({ ...currentPolicy, ...snapshot.policy }, null, 2)}\n`, 'utf8');
    return response.status(200).json({ ok: true, mode: 'policy', restored: true, changedKeys: drift.changedKeys });
  }

  if (mode !== 'note') {
    return response.status(400).json({ error: 'INVALID_RESTORE_MODE' });
  }

  const noteId = typeof body.noteId === 'string' ? body.noteId : null;
  if (!noteId) {
    return response.status(400).json({ error: 'INVALID_NOTE_ID' });
  }

  const snapshot = loadSnapshot(resolve(process.cwd(), 'restore-backup.json'));
  const currentData = readDataFile(resolve(process.cwd(), 'data.json'));
  const result = restoreSingleNote({
    currentNotes: currentData.notes,
    backupNotes: snapshot.notes,
    noteId,
    ownerId: typeof body.ownerId === 'string' ? body.ownerId : undefined,
  });

  const nextData = { ...currentData, notes: result.currentNotes };
  writeDataFile(resolve(process.cwd(), 'data.json'), nextData);

  return response.status(200).json({
    ok: true,
    restored: true,
    noteId: result.note.id,
    owner_id: result.note.owner_id,
    hash: result.note.hash,
    preservedNotes: nextData.notes.length,
  });
}
