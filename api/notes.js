import { createClient as createSupabaseClient } from '@supabase/supabase-js';

export function createNotesHandler({
  env = process.env,
  createClient = createSupabaseClient,
} = {}) {
  return async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    }

    const url = env.SUPABASE_URL;
    const secretKey = env.SUPABASE_SECRET_KEY;
    if (typeof url !== 'string' || !url.trim() || url !== url.trim()
        || typeof secretKey !== 'string' || !secretKey.trim() || secretKey !== secretKey.trim()) {
      return response.status(500).json({ error: 'SERVER_CONFIGURATION_ERROR' });
    }

    const supabase = createClient(url, secretKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    const { data, error } = await supabase.from('learning_notes')
      .select('title,content')
      .order('id', { ascending: true });
    if (error || !Array.isArray(data)) {
      return response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
    }
    return response.status(200).json({ notes: data });
  };
}

export default createNotesHandler();
