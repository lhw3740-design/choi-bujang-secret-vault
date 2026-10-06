import { createNotesAuthenticator } from '../../src/notes-auth.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const authenticate = createNotesAuthenticator();

function invalidBody(body) {
  return !body || typeof body !== 'object' || Array.isArray(body)
    || typeof body.title !== 'string' || !body.title.trim()
    || typeof body.body !== 'string' || !body.body.trim();
}

function responseNote(row) {
  return { id: row.id, title: row.title, body: row.content };
}

export async function handleNoteItem(request, response, {
  authenticateRequest = authenticate,
  id = request.query?.id,
} = {}) {
  response.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'PUT', 'DELETE'].includes(request.method)) {
    response.setHeader('Allow', 'GET, PUT, DELETE');
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }
  const auth = await authenticateRequest(request);
  if (auth.error) return response.status(auth.status).json({ error: auth.error });
  if (typeof id !== 'string' || !UUID.test(id)) {
    return response.status(400).json({ error: 'INVALID_NOTE_ID' });
  }

  if (request.method === 'GET') {
    const { data, error } = await auth.supabase.from('learning_notes')
      .select('id,title,content')
      .eq('id', id)
      .eq('owner_id', auth.userId)
      .maybeSingle();
    if (error) return response.status(502).json({ error: 'NOTE_READ_FAILED' });
    if (!data) return response.status(404).json({ error: 'NOTE_NOT_FOUND' });
    return response.status(200).json(responseNote(data));
  }

  if (request.method === 'PUT') {
    if (invalidBody(request.body)) return response.status(400).json({ error: 'INVALID_NOTE' });
    const { data, error } = await auth.supabase.from('learning_notes')
      .update({
        title: request.body.title.trim(),
        content: request.body.body,
        owner_id: auth.userId,
      })
      .eq('id', id)
      .eq('owner_id', auth.userId)
      .select('id,title,content')
      .maybeSingle();
    if (error) return response.status(502).json({ error: 'NOTE_UPDATE_FAILED' });
    if (!data) return response.status(404).json({ error: 'NOTE_NOT_FOUND' });
    return response.status(200).json(responseNote(data));
  }

  const { data, error } = await auth.supabase.from('learning_notes')
    .delete()
    .eq('id', id)
    .eq('owner_id', auth.userId)
    .select('id')
    .maybeSingle();
  if (error) return response.status(502).json({ error: 'NOTE_DELETE_FAILED' });
  if (!data) return response.status(404).json({ error: 'NOTE_NOT_FOUND' });
  return response.status(204).end();
}

export default async function handler(request, response) {
  return handleNoteItem(request, response);
}
