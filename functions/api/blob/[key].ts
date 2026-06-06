/// <reference types="@cloudflare/workers-types" />

interface Env {
  BUCKET: R2Bucket;
  APP_PASSWORD: string;
}

function unauthorized(request: Request, env: Env): Response | null {
  const provided = request.headers.get('x-app-password');
  if (!env.APP_PASSWORD || provided !== env.APP_PASSWORD) {
    return new Response('Unauthorized', { status: 401 });
  }
  return null;
}

/** Parse an HTTP `Range: bytes=…` header into an R2 range option. */
function parseRange(header: string | null): R2Range | undefined {
  if (!header) return undefined;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return undefined;
  const [, startStr, endStr] = m;
  if (startStr === '' && endStr === '') return undefined;
  if (startStr === '') return { suffix: Number(endStr) };
  const offset = Number(startStr);
  if (endStr === '') return { offset };
  return { offset, length: Number(endStr) - offset + 1 };
}

export const onRequestGet: PagesFunction<Env> = async ({ params, env, request }) => {
  const key = params.key as string;
  const range = parseRange(request.headers.get('Range'));

  const object = range
    ? await env.BUCKET.get(key, { range })
    : await env.BUCKET.get(key);
  if (!object) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Accept-Ranges', 'bytes');
  // Keys are random UUIDs, so a blob's bytes never change — cache aggressively.
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');

  if (range && object.range) {
    const start = 'offset' in object.range && object.range.offset != null ? object.range.offset : 0;
    const length = 'length' in object.range && object.range.length != null
      ? object.range.length
      : object.size - start;
    headers.set('Content-Range', `bytes ${start}-${start + length - 1}/${object.size}`);
    headers.set('Content-Length', String(length));
    return new Response(object.body, { status: 206, headers });
  }

  headers.set('Content-Length', String(object.size));
  return new Response(object.body, { status: 200, headers });
};

// Note: uploads no longer go through here — the client uses presigned
// direct-to-R2 URLs (see functions/api/upload-url) so large videos bypass the
// Functions request-body limit. This route only serves and deletes blobs.

export const onRequestDelete: PagesFunction<Env> = async ({ params, env, request }) => {
  const denied = unauthorized(request, env);
  if (denied) return denied;

  await env.BUCKET.delete(params.key as string);
  return new Response(null, { status: 204 });
};
