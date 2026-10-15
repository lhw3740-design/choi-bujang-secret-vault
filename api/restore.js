import { resolve } from 'node:path';
import { createNotesAuthenticator } from '../src/notes-auth.mjs';
import { diffPolicy, loadSnapshot, loadVerifiedSnapshot, noteHash } from '../src/restore.mjs';

const authenticate = createNotesAuthenticator();
const defaultSnapshotPath = resolve(process.cwd(), 'restore-backup.json');

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

function reportUnverifiedSnapshot(error) {
  console.error('trusted_restore_snapshot_unavailable', {
    code: typeof error?.code === 'string' ? error.code : 'INVALID_OR_UNVERIFIED_SNAPSHOT',
  });
}

async function readTestPolicy(supabase) {
  const { data, error } = await supabase.from('learning_test_policy_state')
    .select('policy,revision')
    .eq('id', 'active')
    .maybeSingle();
  if (error) return { error: 'TEST_POLICY_UNAVAILABLE', status: 502 };
  if (!data) return { error: 'TEST_POLICY_NOT_FOUND', status: 404 };
  if (!data.policy || typeof data.policy !== 'object' || Array.isArray(data.policy)
      || !Number.isSafeInteger(data.revision) || data.revision < 1) {
    return { error: 'TEST_POLICY_INVALID', status: 409 };
  }
  return { policy: data.policy, revision: data.revision };
}

async function handlePolicyRestore(body, response, auth, snapshotPath) {
  if (!['preview', 'restore'].includes(body.action)) {
    return response.status(400).json({ error: 'INVALID_POLICY_RESTORE_ACTION' });
  }

  let verified;
  try {
    verified = loadVerifiedSnapshot(snapshotPath);
  } catch (error) {
    reportUnverifiedSnapshot(error);
    return response.status(503).json({ error: 'TRUSTED_BACKUP_UNAVAILABLE' });
  }

  const current = await readTestPolicy(auth.supabase);
  if (current.error) return response.status(current.status).json({ error: current.error });
  const changes = diffPolicy(current.policy, verified.snapshot.policy);

  if (body.action === 'preview') {
    return response.status(200).json({
      ok: true,
      mode: 'policy',
      action: 'preview',
      backupVersion: verified.snapshot.policyVersion,
      backupHash: verified.digest,
      currentRevision: current.revision,
      changedKeys: changes.changedKeys,
      changes: changes.changes,
    });
  }

  if (body.confirmHash !== verified.digest) {
    return response.status(409).json({ error: 'POLICY_RESTORE_CONFIRMATION_MISMATCH' });
  }
  if (body.expectedRevision !== current.revision) {
    return response.status(409).json({ error: 'TEST_POLICY_CHANGED' });
  }
  if (changes.changedKeys.length === 0) {
    return response.status(200).json({
      ok: true,
      mode: 'policy',
      restored: false,
      currentRevision: current.revision,
      changedKeys: [],
    });
  }

  let verifiedAgain;
  try {
    verifiedAgain = loadVerifiedSnapshot(snapshotPath);
  } catch (error) {
    reportUnverifiedSnapshot(error);
    return response.status(503).json({ error: 'TRUSTED_BACKUP_UNAVAILABLE' });
  }
  if (verifiedAgain.digest !== verified.digest
      || verifiedAgain.snapshot.policyVersion !== verified.snapshot.policyVersion) {
    return response.status(409).json({ error: 'BACKUP_VERIFICATION_FAILED' });
  }

  const latest = await readTestPolicy(auth.supabase);
  if (latest.error) return response.status(latest.status).json({ error: latest.error });
  if (latest.revision !== current.revision
      || JSON.stringify(latest.policy) !== JSON.stringify(current.policy)) {
    return response.status(409).json({ error: 'TEST_POLICY_CHANGED' });
  }

  const { data, error } = await auth.supabase.rpc('restore_learning_test_policy', {
    p_expected_revision: current.revision,
    p_expected_policy: current.policy,
    p_restored_policy: verifiedAgain.snapshot.policy,
    p_actor_id: auth.userId,
    p_backup_version: verifiedAgain.snapshot.policyVersion,
    p_backup_sha256: verifiedAgain.digest,
    p_changed_keys: changes.changedKeys,
  });
  if (error) {
    const status = error.code === '40001' ? 409 : 502;
    return response.status(status).json({
      error: status === 409 ? 'TEST_POLICY_CHANGED' : 'POLICY_RESTORE_FAILED',
    });
  }
  const restored = Array.isArray(data) ? data[0] : data;
  if (!restored || !Number.isSafeInteger(restored.revision)) {
    return response.status(502).json({ error: 'POLICY_RESTORE_FAILED' });
  }
  return response.status(200).json({
    ok: true,
    mode: 'policy',
    restored: true,
    backupVersion: verifiedAgain.snapshot.policyVersion,
    currentRevision: restored.revision,
    changedKeys: changes.changedKeys,
  });
}

export async function handleRestore(request, response, {
  authenticateRequest = authenticate,
  snapshotPath = defaultSnapshotPath,
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
  if (mode === 'policy') {
    return handlePolicyRestore(body, response, auth, snapshotPath);
  }
  if (!['preview', 'restore'].includes(mode)) {
    return response.status(400).json({ error: 'INVALID_RESTORE_MODE' });
  }

  const requestedNoteId = typeof body.noteId === 'string' ? body.noteId : null;
  if (!requestedNoteId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(requestedNoteId)) {
    return response.status(400).json({ error: 'INVALID_NOTE_ID' });
  }
  const noteId = requestedNoteId.toLowerCase();

  if (mode === 'restore') {
    try {
      loadSnapshot(snapshotPath);
    } catch (error) {
      console.error('trusted_restore_snapshot_unavailable', {
        code: typeof error?.code === 'string' ? error.code : 'INVALID_OR_UNVERIFIED_SNAPSHOT',
      });
      return response.status(503).json({ error: 'TRUSTED_BACKUP_UNAVAILABLE' });
    }
  }

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
      changedFields: current
        ? ['title', 'content'].filter((field) => current[field] !== backup[field])
        : ['title', 'content'],
    });
  }

  if (body.confirmHash !== backup.content_hash) {
    return response.status(409).json({ error: 'RESTORE_CONFIRMATION_MISMATCH' });
  }
  if (body.expectedCurrentHash !== currentHash) {
    return response.status(409).json({ error: 'RESTORE_TARGET_CHANGED' });
  }

  const verifiedAgain = await readRestoreState(auth.supabase, noteId, auth.userId);
  if (verifiedAgain.error) {
    return response.status(verifiedAgain.status).json({ error: verifiedAgain.error });
  }
  if (verifiedAgain.backup.content_hash !== backup.content_hash
      || verifiedAgain.backup.snapshot_version !== backup.snapshot_version
      || verifiedAgain.backup.verified_at !== backup.verified_at) {
    return response.status(409).json({ error: 'BACKUP_VERIFICATION_FAILED' });
  }
  const latestCurrentHash = verifiedAgain.current ? noteHash(verifiedAgain.current) : null;
  if (latestCurrentHash !== currentHash) {
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
