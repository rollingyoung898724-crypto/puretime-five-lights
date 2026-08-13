import { getSupabaseAdmin } from './supabase-admin.js';

function dbError(error, fallback = 'DATABASE_ERROR') {
  const known = String(error?.message || '');
  const code = known.includes('INSUFFICIENT_CREDITS') ? 'INSUFFICIENT_CREDITS'
    : known.includes('ACCOUNT_HOLD') ? 'ACCOUNT_HOLD'
      : known.includes('ACCOUNT_NOT_FOUND') ? 'CREDIT_ACCOUNT_NOT_FOUND'
      : fallback;
  const message = code === 'INSUFFICIENT_CREDITS'
    ? 'You do not have enough AI Story Credits.'
    : code === 'ACCOUNT_HOLD'
      ? 'AI generation is paused while this account is reviewed.'
      : code === 'CREDIT_ACCOUNT_NOT_FOUND'
        ? 'The credit account could not be found.'
        : code === 'FREE_GRANT_FAILED'
          ? 'The initial credits could not be granted.'
          : 'The database operation could not be completed.';
  const status = code === 'INSUFFICIENT_CREDITS' ? 402
    : code === 'CREDIT_ACCOUNT_NOT_FOUND' ? 404
      : code === 'ACCOUNT_HOLD' ? 409
        : 503;
  return Object.assign(new Error(message), { code, status, expose: true });
}

export function createCreditStore(admin = getSupabaseAdmin()) {
  async function rpc(name, params, fallbackCode = 'DATABASE_ERROR') {
    const { data, error } = await admin.rpc(name, params);
    if (error) throw dbError(error, fallbackCode);
    return Array.isArray(data) ? data[0] : data;
  }

  return {
    async ensureAccount(userId) {
      await rpc('ensure_credit_account', { p_user_id: userId });
      await rpc('grant_initial_free_credits', { p_user_id: userId }, 'FREE_GRANT_FAILED');
      return this.getBalance(userId);
    },
    async getBalance(userId) {
      const { data, error } = await admin.from('ai_credit_accounts')
        .select('balance,account_hold,free_credits_granted,updated_at')
        .eq('user_id', userId).maybeSingle();
      if (error) throw dbError(error);
      if (!data) throw Object.assign(new Error('The credit account could not be found.'), { code: 'CREDIT_ACCOUNT_NOT_FOUND', status: 404, expose: true });
      return data;
    },
    async findGeneration(userId, requestId) {
      const { data, error } = await admin.from('story_generations')
        .select('request_id,status,title,body,visual_facts,atmosphere,photo_relevance,safety_flags,model_name,error_code')
        .eq('user_id', userId).eq('request_id', requestId).maybeSingle();
      if (error) throw dbError(error);
      return data;
    },
    async createGeneration(input) {
      const { error } = await admin.from('story_generations').insert({
        user_id: input.userId,
        request_id: input.requestId,
        prayer_name: input.prayerName,
        selected_state: input.selectedState,
        model_name: input.modelName,
        status: 'reserved'
      });
      if (error?.code === '23505') return false;
      if (error) throw dbError(error);
      return true;
    },
    reserve(userId, requestId) {
      return rpc('reserve_story_credit', { p_user_id: userId, p_request_id: requestId });
    },
    commit(userId, requestId, story) {
      return rpc('commit_story_credit', {
        p_user_id: userId,
        p_request_id: requestId,
        p_title: story.title,
        p_body: story.body,
        p_visual_facts: story.visualFacts,
        p_atmosphere: story.atmosphere,
        p_photo_relevance: story.photoRelevance,
        p_safety_flags: story.safetyFlags
      });
    },
    release(userId, requestId, errorCode) {
      return rpc('release_story_credit', { p_user_id: userId, p_request_id: requestId, p_error_code: errorCode });
    },
    async enforceRateLimit(userId) {
      const sinceMinute = new Date(Date.now() - 60_000).toISOString();
      const sinceDay = new Date(Date.now() - 86_400_000).toISOString();
      const [minute, day] = await Promise.all([
        admin.from('story_generations').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', sinceMinute),
        admin.from('story_generations').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', sinceDay)
      ]);
      if (minute.error || day.error) throw dbError(minute.error || day.error);
      if ((minute.count || 0) >= 3) throw Object.assign(new Error('Please wait before trying again.'), { code: 'RATE_LIMITED', status: 429, expose: true });
      if ((day.count || 0) >= 30) throw Object.assign(new Error('The daily AI story limit has been reached.'), { code: 'DAILY_LIMIT_REACHED', status: 429, expose: true });
    }
  };
}
