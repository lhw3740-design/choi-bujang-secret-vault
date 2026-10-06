import { createClient } from '@supabase/supabase-js';
import appConfig from '../aleph.config.json' with { type: 'json' };
import { createLoginVerifier } from './verify-login.mjs';

export function createNotesAuthenticator({
  env = process.env,
  createSupabaseClient = createClient,
  createVerifier = createLoginVerifier,
  config = appConfig,
} = {}) {
  let authContext;
  return async function authenticate(request) {
    if (!authContext) {
      const url = env.SUPABASE_URL;
      const secretKey = env.SUPABASE_SECRET_KEY;
      if (typeof url !== 'string' || !url.trim() || url !== url.trim()
          || typeof secretKey !== 'string' || !secretKey.trim() || secretKey !== secretKey.trim()) {
        return { error: 'SERVER_CONFIGURATION_ERROR', status: 500 };
      }

      const supabase = createSupabaseClient(url, secretKey, {
        auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      });
      try {
        const verifyAuthorization = createVerifier({
          config,
          supabaseSecretKey: secretKey,
          supabaseClient: supabase,
        });
        authContext = { supabase, verifyAuthorization };
      } catch {
        return { error: 'AUTHENTICATION_CONFIGURATION_ERROR', status: 500 };
      }
    }

    const identity = await authContext.verifyAuthorization(request.headers?.authorization);
    if (identity?.kind !== 'student' || typeof identity.userId !== 'string' || !identity.userId) {
      return { error: 'AUTHENTICATION_REQUIRED', status: 401 };
    }
    return { supabase: authContext.supabase, userId: identity.userId };
  };
}
