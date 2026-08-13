export function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

export function success(data = {}, status = 200) {
  return json({ success: true, ...data }, status);
}

export function failure(code, message, status = 400) {
  return json({ success: false, error: { code, message } }, status);
}

export function methodNotAllowed(allowed) {
  return new Response(JSON.stringify({
    success: false,
    error: { code: 'METHOD_NOT_ALLOWED', message: 'This method is not allowed.' }
  }), {
    status: 405,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      Allow: allowed.join(', ')
    }
  });
}

export async function readJson(request, maxBytes = 2_100_000) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > maxBytes) throw Object.assign(new Error('Request body is too large.'), { code: 'REQUEST_TOO_LARGE', status: 413 });
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw Object.assign(new Error('Request body is too large.'), { code: 'REQUEST_TOO_LARGE', status: 413 });
  try {
    return JSON.parse(text || '{}');
  } catch {
    throw Object.assign(new Error('Request body must be valid JSON.'), { code: 'INVALID_JSON', status: 400 });
  }
}

export function safeError(error) {
  if (error?.name === 'ZodError') return failure('VALIDATION_ERROR', 'The request fields are not valid.', 400);
  return failure(error?.code || 'INTERNAL_ERROR', error?.expose ? error.message : 'The request could not be completed.', error?.status || 500);
}
