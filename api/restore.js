import { createNotesAuthenticator } from '../src/notes-auth.mjs';
import { noteHash } from '../src/restore.mjs';

const authenticate = createNotesAuthenticator();

function validBackupRecord(record, noteId) {
  if (!record || record.note_id !== noteId
      || typeof record.owner_id !== 'string'
      || typeof record.title !== 'string' || typeof record.content !== 'string'
      || typeof record.content_hash !== 'string' || !/^[a-f0-9]{64}$/u.test(record.content_hash)
      || typeof record.snapshot_version !== 'string' || !record.snapshot_version.trim()
      || typeof record.verified_at !== 'string' || !Number.isFinite(Date.parse(record.verified_at))) {
    return false;
  }
  return noteHash(record) === record.content_hash;
}

async function readRestoreState(supabase, noteId, ownerId) {
  const { data: backup, error: backupError } = await supabase.from('learning_note_backups')
    .select('note_id,owner_id,title,content,content_hash,snapshot_version,verified_at')
    .eq('note_id', noteId)
    .eq('owner_id', ownerId)
    .maybeSingle();
  if (backupError) return { error: 'BACKUP_UNAVAILABLE', status: 502 };
  if (!backup) return { error: 'VERIFIED_BACKUP_NOT_FOUND', status: 404 };
  if (!validBackupRecord(backup, noteId)) {
    return { error: 'BACKUP_VERIFICATION_FAILED', status: 409 };
  }
  if (backup.owner_id !== ownerId) return { error: 'NOTE_NOT_FOUND', status: 404 };

  const { data: current, error: currentError } = await supabase.from('learning_notes')
    .select('id,owner_id,title,content')
    .eq('id', noteId)
    .maybeSingle();
  if (currentError) return { error: 'RESTORE_TARGET_UNAVAILABLE', status: 502 };
  if (current && current.owner_id !== ownerId) return { error: 'NOTE_NOT_FOUND', status: 404 };

  return { backup, current };
}

export async function handleRestore(request, response, {
  authenticateRequest = authenticate,
} = {}) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  const auth = await authenticateRequest(request);
  if (auth.error) return response.status(auth.status).json({ error: auth.error });

  const body = request.body && typeof request.body === 'object' ? request.body : {};
  const mode = body.mode;
  if (!['preview', 'restore'].includes(mode)) {
    if (mode === 'policy') {
      return response.status(501).json({ error: 'POLICY_RESTORE_UNAVAILABLE' });
    }
    return response.status(400).json({ error: 'INVALID_RESTORE_MODE' });
  }

  const requestedNoteId = typeof body.noteId === 'string' ? body.noteId : null;
  if (!requestedNoteId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(requestedNoteId)) {
    return response.status(400).json({ error: 'INVALID_NOTE_ID' });
  }
  const noteId = requestedNoteId.toLowerCase();

  const state = await readRestoreState(auth.supabase, noteId, auth.userId);
  if (state.error) return response.status(state.status).json({ error: state.error });
  const { backup, current } = state;
  const currentHash = current ? noteHash(current) : null;

  if (mode === 'preview') {
    return response.status(200).json({
      ok: true,
      mode,
      noteId,
      owner_id: backup.owner_id,
      snapshotVersion: backup.snapshot_version,
      verifiedAt: backup.verified_at,
      backupHash: backup.content_hash,
      currentHash,
      currentState: current ? 'present' : 'missing',
    });
  }

  if (body.confirmHash !== backup.content_hash) {
    return response.status(409).json({ error: 'RESTORE_CONFIRMATION_MISMATCH' });
  }
  if (body.expectedCurrentHash !== currentHash) {
    return response.status(409).json({ error: 'RESTORE_TARGET_CHANGED' });
  }

  const restoredValues = {
    title: backup.title,
    content: backup.content,
    owner_id: auth.userId,
  };
  if (current) {
    const { data, error } = await auth.supabase.from('learning_notes')
      .update(restoredValues)
      .eq('id', noteId)
      .eq('owner_id', auth.userId)
      .eq('title', current.title)
      .eq('content', current.content)
      .select('id,owner_id,title,content')
      .maybeSingle();
    if (error) return response.status(502).json({ error: 'NOTE_RESTORE_FAILED' });
    if (!data) return response.status(409).json({ error: 'RESTORE_TARGET_CHANGED' });
    if (data.id !== noteId || data.owner_id !== auth.userId || noteHash(data) !== backup.content_hash) {
      return response.status(502).json({ error: 'NOTE_RESTORE_VERIFICATION_FAILED' });
    }
  } else {
    const { data, error } = await auth.supabase.from('learning_notes')
      .insert({ id: noteId, ...restoredValues })
      .select('id,owner_id,title,content')
      .maybeSingle();
    if (error) {
      const status = error.code === '23505' ? 409 : 502;
      return response.status(status).json({
        error: status === 409 ? 'RESTORE_TARGET_CHANGED' : 'NOTE_RESTORE_FAILED',
      });
    }
    if (!data) return response.status(502).json({ error: 'NOTE_RESTORE_FAILED' });
    if (data.id !== noteId || data.owner_id !== auth.userId || noteHash(data) !== backup.content_hash) {
      return response.status(502).json({ error: 'NOTE_RESTORE_VERIFICATION_FAILED' });
    }
  }

  return response.status(200).json({
    ok: true,
    mode,
    restored: true,
    noteId,
    owner_id: auth.userId,
    restoredHash: backup.content_hash,
    snapshotVersion: backup.snapshot_version,
  });
}

export default async function handler(request, response) {
  return handleRestore(request, response);
}
