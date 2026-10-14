import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const VERIFIED_SNAPSHOT_SHA256 = 'e13198da9aed4e0940405c7d01e6cdce72da4ec21812e6cc37a8cd3c17571786';

export function canonicalize(value) {
  return JSON.stringify(value, Object.keys(value ?? {}).sort());
}

export function noteHash(note) {
  const fields = [
    note?.id ?? note?.note_id,
    note?.owner_id,
    note?.title,
    note?.content,
  ];
  if (fields.some((value) => typeof value !== 'string')) {
    throw new Error('메모 백업의 해시 입력이 올바르지 않습니다.');
  }
  const payload = `note-backup-v1|${fields
    .map((value) => `${Buffer.byteLength(value, 'utf8')}:${value}`)
    .join('|')}`;
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

export function loadSnapshot(snapshotPath = resolve(process.cwd(), 'restore-backup.json')) {
  const raw = readFileSync(snapshotPath, 'utf8');
  const digest = createHash('sha256').update(raw).digest('hex');
  if (digest !== VERIFIED_SNAPSHOT_SHA256) {
    throw new Error('복원 사본의 무결성 검증에 실패했습니다.');
  }
  const snapshot = JSON.parse(raw);
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('복원 사본이 비어 있습니다.');
  }
  if (!Array.isArray(snapshot.notes)) {
    throw new Error('복원 사본에 notes 배열이 필요합니다.');
  }
  if (!snapshot.policy || typeof snapshot.policy !== 'object') {
    throw new Error('복원 사본에 정책 정보가 필요합니다.');
  }
  return snapshot;
}

export function diffPolicy(currentPolicy, backupPolicy) {
  const keys = new Set([
    ...Object.keys(currentPolicy ?? {}),
    ...Object.keys(backupPolicy ?? {}),
  ]);
  const changes = [];
  for (const key of [...keys].sort()) {
    const currentValue = currentPolicy?.[key];
    const backupValue = backupPolicy?.[key];
    if (JSON.stringify(currentValue) !== JSON.stringify(backupValue)) {
      changes.push({ key, from: currentValue, to: backupValue });
    }
  }
  return {
    changedKeys: changes.map((change) => change.key),
    summary: changes.length === 0 ? 'no-policy-drift' : `${changes.length} policy changes`,
    changes,
  };
}

export function restorePolicyVersion(currentPolicy, backupPolicy) {
  const drift = diffPolicy(currentPolicy, backupPolicy);
  if (drift.changedKeys.length === 0) {
    return { applied: false, diff: drift, policy: currentPolicy };
  }
  return {
    applied: true,
    diff: drift,
    policy: {
      ...currentPolicy,
      ...backupPolicy,
    },
  };
}

export function restoreSingleNote({ currentNotes = [], backupNotes = [], noteId, ownerId }) {
  if (typeof noteId !== 'string' || !noteId.trim()) {
    throw new Error('복구할 noteId가 필요합니다.');
  }
  const backupNote = backupNotes.find((note) => note?.id === noteId);
  if (!backupNote) {
    throw new Error('복원 사본에 해당 메모가 없습니다.');
  }
  if (typeof ownerId === 'string' && backupNote.owner_id !== ownerId) {
    throw new Error('복원 사본의 소유자와 요청한 소유자가 다릅니다.');
  }
  const currentNote = currentNotes.find((note) => note?.id === noteId);
  const hash = noteHash(backupNote);
  const nextNotes = Array.isArray(currentNotes)
    ? currentNotes.filter((note) => note?.id !== noteId)
    : [];
  nextNotes.push({
    id: backupNote.id,
    title: backupNote.title,
    content: backupNote.content,
    owner_id: backupNote.owner_id,
    restoredFromBackup: true,
    backupHash: hash,
  });
  return {
    note: {
      id: backupNote.id,
      owner_id: backupNote.owner_id,
      title: backupNote.title,
      content: backupNote.content,
      hash,
    },
    currentNotes: nextNotes,
    replaced: Boolean(currentNote),
  };
}

export function persistSnapshot(snapshotPath, nextSnapshot) {
  writeFileSync(snapshotPath, `${JSON.stringify(nextSnapshot, null, 2)}\n`, 'utf8');
  return nextSnapshot;
}
