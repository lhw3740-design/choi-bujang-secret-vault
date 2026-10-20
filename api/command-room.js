import { resolve } from 'node:path';
import config from '../aleph.config.json' with { type: 'json' };
import { createNotesAuthenticator } from '../src/notes-auth.mjs';
import { detect } from '../src/detect.mjs';
import { RULE_IDS } from '../src/decider.mjs';
import { diffPolicy, loadSnapshot, noteHash } from '../src/restore.mjs';
import { findDevice, hashHandle, readHandle } from './device.js';

const authenticate = createNotesAuthenticator();
const defaultSnapshotPath = resolve(process.cwd(), 'restore-backup.json');
const MAX_BACKUP_ROWS = 50;

// 상태 값: verified = 이번 요청에서 서버가 실제로 읽고 확인함, unavailable = 확인 시도했으나 실패,
// not_connected = 이 저장소에는 실제 응답을 받을 연결이 없어 실행하지 않음(통과 근거 아님).
const NOT_CONNECTED = Object.freeze({
  status: 'not_connected',
  note: '운영 엔진의 실제 응답을 받는 연결이 이 저장소에 없어 실행하지 않았습니다. 통과 근거로 쓰지 않습니다.',
});

async function readBackupSummary(supabase, ownerId) {
  const { data, error } = await supabase.from('learning_note_backups')
    .select('note_id,owner_id,title,content,content_hash,snapshot_version,verified_at')
    .eq('owner_id', ownerId);
  if (error || !Array.isArray(data)) return { status: 'unavailable', count: null, items: [] };
  // 메모 제목·본문은 해시 확인에만 쓰고 응답에는 넣지 않는다. 메모 ID는 앞 8자만 보여 준다.
  const items = data.slice(0, MAX_BACKUP_ROWS).map((row) => {
    let hashOk = false;
    try {
      hashOk = typeof row.content_hash === 'string' && noteHash(row) === row.content_hash;
    } catch {
      hashOk = false;
    }
    return {
      noteIdPrefix: typeof row.note_id === 'string' ? row.note_id.slice(0, 8) : '',
      snapshotVersion: row.snapshot_version,
      verifiedAt: row.verified_at,
      hashOk,
    };
  });
  return { status: 'verified', count: data.length, items };
}

export async function handleCommandRoom(request, response, {
  authenticateRequest = authenticate,
  snapshotPath = defaultSnapshotPath,
  now = () => new Date(),
} = {}) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  const auth = await authenticateRequest(request);
  if (auth.error) return response.status(auth.status).json({ error: auth.error });

  // 서버가 이 기기를 승인 기기로 확인한 경우에만 요약을 돌려준다.
  const handle = readHandle(request);
  const device = handle ? await findDevice(auth.supabase, auth.userId, hashHandle(handle)) : { state: 'unregistered' };
  if (device.error) return response.status(device.status).json({ error: device.error });
  if (device.state !== 'approved') return response.status(403).json({ error: 'DEVICE_NOT_APPROVED' });

  let recovery;
  try {
    const snapshot = loadSnapshot(snapshotPath);
    const currentPolicy = {
      step: config.step,
      allowedRoutes: config.allowedRoutes,
      restoreRoute: config.restoreRoute,
    };
    const drift = diffPolicy(currentPolicy, snapshot.policy);
    recovery = {
      status: 'verified',
      snapshotVersion: snapshot.version,
      policyVersion: snapshot.policyVersion,
      policyChangedKeys: drift.changedKeys,
    };
  } catch {
    recovery = { status: 'unavailable', snapshotVersion: null, policyVersion: null, policyChangedKeys: [] };
  }
  recovery.noteBackups = await readBackupSummary(auth.supabase, auth.userId);

  return response.status(200).json({
    ok: true,
    generatedAt: now().toISOString(),
    decider: {
      status: 'verified',
      source: 'src/decider.mjs',
      ruleIds: [...RULE_IDS],
      engineDecisions: { ...NOT_CONNECTED },
    },
    detection: {
      status: typeof detect === 'function' ? 'verified' : 'unavailable',
      source: 'src/detect.mjs',
      engineEvents: { ...NOT_CONNECTED },
    },
    revocation: { ...NOT_CONNECTED },
    recovery,
  });
}

export default async function handler(request, response) {
  return handleCommandRoom(request, response);
}
