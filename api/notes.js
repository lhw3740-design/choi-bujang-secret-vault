import { randomUUID } from 'node:crypto';
import { createNotesAuthenticator } from '../src/notes-auth.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const authenticate = createNotesAuthenticator();

function invalidBody(body, allowId) {
  return !body || typeof body !== 'object' || Array.isArray(body)
    || typeof body.title !== 'string' || !body.title.trim()
    || typeof body.body !== 'string' || !body.body.trim()
    || (body.id !== undefined && (!allowId || typeof body.id !== 'string' || !UUID.test(body.id)));
}

export async function handleNotesCollection(request, response, {
  authenticateRequest = authenticate,
  createId = randomUUID,
} = {}) {
  response.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'POST'].includes(request.method)) {
    response.setHeader('Allow', 'GET, POST');
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  const auth = await authenticateRequest(request);
  if (auth.error) return response.status(auth.status).json({ error: auth.error });

  if (request.method === 'GET') {
    const { data, error } = await auth.supabase.from('learning_notes')
      .select('id,title,content')
      .eq('owner_id', auth.userId)
      .order('id', { ascending: true });
    if (error || !Array.isArray(data)) {
      return response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
    }
    return response.status(200).json(data.map(({ id, title, content }) => ({
      id, title, body: content,
    })));
  }

  if (invalidBody(request.body, true)) {
    return response.status(400).json({ error: 'INVALID_NOTE' });
  }
  const id = request.body.id ?? createId();
  const { error } = await auth.supabase.from('learning_notes').insert({
    id,
    title: request.body.title.trim(),
    content: request.body.body,
    owner_id: auth.userId,
  });
  if (error) {
    const code = typeof error.code === 'string' && /^[A-Z0-9_-]{1,32}$/u.test(error.code)
      ? error.code
      : undefined;
    console.error('note_create_failed', { code: code ?? 'UNKNOWN' });
    return response.status(502).json({
      error: 'NOTE_CREATE_FAILED',
      ...(code ? { code } : {}),
    });
  }
  return response.status(201).json({ id });
}

export function createNotesHandler(options = {}) {
  const { authenticateRequest: injectedAuthenticator, createId = randomUUID, createClient, ...authOptions } = options;
  const authenticateRequest = injectedAuthenticator ?? createNotesAuthenticator({
    ...authOptions,
    ...(createClient ? { createSupabaseClient: createClient } : {}),
  });
  return (request, response) => handleNotesCollection(request, response, {
    authenticateRequest,
    createId,
  });
}

export default createNotesHandler();
