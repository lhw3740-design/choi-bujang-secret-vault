import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import appConfig from '../aleph.config.json' with { type: 'json' };
import { createLoginVerifier } from '../src/verify-login.mjs';

export function createNotesHandler({
  env = process.env,
  createClient = createSupabaseClient,
  createVerifier = createLoginVerifier,
  config = appConfig,
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
    let verifyAuthorization;
    try {
      verifyAuthorization = createVerifier({
        config,
        supabaseSecretKey: secretKey,
        supabaseClient: supabase,
      });
    } catch {
      return response.status(500).json({ error: 'AUTHENTICATION_CONFIGURATION_ERROR' });
    }

    const identity = await verifyAuthorization(request.headers?.authorization);
    if (!identity) {
      return response.status(401).json({ error: 'AUTHENTICATION_REQUIRED' });
    }

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
