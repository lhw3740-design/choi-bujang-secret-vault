import { createHash, randomBytes } from 'node:crypto';
import { createNotesAuthenticator } from '../src/notes-auth.mjs';

const authenticate = createNotesAuthenticator();
const COOKIE_NAME = '__Host-aleph_device';
const MAX_PENDING_PER_USER = 5;
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 90;
const STATES = new Set(['pending', 'approved', 'revoked']);

function hashHandle(handle) {
  return createHash('sha256').update(handle, 'utf8').digest('hex');
}

function readHandle(request) {
  const header = request.headers?.cookie;
  if (typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE_NAME) {
      const value = rest.join('=');
      return /^[A-Za-z0-9_-]{43}$/u.test(value) ? value : null;
    }
  }
  return null;
}

// 서버가 만든 무작위 값은 JavaScript가 읽을 수 없는 쿠키(HttpOnly)에만 둡니다.
// 브라우저 저장소에는 기기 키나 승인 상태를 넣지 않고, 서버에는 지문(SHA-256)만 남깁니다.
function setHandleCookie(response, handle) {
  response.setHeader('Set-Cookie',
    `${COOKIE_NAME}=${handle}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE_SECONDS}`);
}

async function findDevice(supabase, ownerId, deviceHash) {
  const { data, error } = await supabase.from('device_approvals')
    .select('status')
    .eq('owner_id', ownerId)
    .eq('device_hash', deviceHash)
    .maybeSingle();
  if (error) return { error: 'DEVICE_STORE_UNAVAILABLE', status: 502 };
  if (!data || !STATES.has(data.status)) return { state: 'unregistered' };
  return { state: data.status };
}

export async function handleDevice(request, response, { authenticateRequest = authenticate } = {}) {
  response.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'POST'].includes(request.method)) {
    response.setHeader('Allow', 'GET, POST');
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  const auth = await authenticateRequest(request);
  if (auth.error) return response.status(auth.status).json({ error: auth.error });

  const handle = readHandle(request);
  const existing = handle ? await findDevice(auth.supabase, auth.userId, hashHandle(handle)) : { state: 'unregistered' };
  if (existing.error) return response.status(existing.status).json({ error: existing.error });

  if (request.method === 'GET') {
    return response.status(200).json({ ok: true, state: existing.state });
  }

  // 승인 요청은 대기 기록만 만듭니다. 요청 본문의 상태·사용자·기기 값은 읽지 않고,
  // 승인(approved)은 운영자가 데이터베이스에서만 바꿀 수 있습니다.
  if (existing.state !== 'unregistered') {
    return response.status(200).json({ ok: true, state: existing.state });
  }

  const { data: pending, error: pendingError } = await auth.supabase.from('device_approvals')
    .select('id')
    .eq('owner_id', auth.userId)
    .eq('status', 'pending');
  if (pendingError) return response.status(502).json({ error: 'DEVICE_STORE_UNAVAILABLE' });
  if (Array.isArray(pending) && pending.length >= MAX_PENDING_PER_USER) {
    return response.status(429).json({ error: 'TOO_MANY_PENDING_DEVICES' });
  }

  const newHandle = randomBytes(32).toString('base64url');
  const { error: insertError } = await auth.supabase.from('device_approvals')
    .insert({ owner_id: auth.userId, device_hash: hashHandle(newHandle), status: 'pending' });
  if (insertError) return response.status(502).json({ error: 'DEVICE_REQUEST_FAILED' });

  setHandleCookie(response, newHandle);
  return response.status(202).json({ ok: true, state: 'pending' });
}

export default async function handler(request, response) {
  return handleDevice(request, response);
}
