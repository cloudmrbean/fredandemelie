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

const storyKey = (id: string) => `story/${id}.json`;

// Mirror of share.ts collectBlobKeys, used to clean up R2 when a story is deleted.
function collectBlobKeys(story: any): string[] {
  const keys: string[] = [];
  if (story?.baseBlobKey) keys.push(story.baseBlobKey);
  if (story?.thumbnailKey) keys.push(story.thumbnailKey);
  for (const point of story?.branchPoints ?? []) {
    for (const branch of Object.values(point?.outcomes ?? {})) {
      const blobKey = (branch as { blobKey?: string } | null)?.blobKey;
      if (blobKey) keys.push(blobKey);
    }
  }
  return keys;
}

export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
  const object = await env.BUCKET.get(storyKey(params.id as string));
  if (!object) return new Response('Not found', { status: 404 });
  return new Response(object.body, {
    headers: { 'content-type': 'application/json' },
  });
};

export const onRequestPut: PagesFunction<Env> = async ({ params, env, request }) => {
  const denied = unauthorized(request, env);
  if (denied) return denied;

  // Validate it parses as JSON before storing.
  const story = await request.json();
  await env.BUCKET.put(storyKey(params.id as string), JSON.stringify(story), {
    httpMetadata: { contentType: 'application/json' },
  });
  return new Response(null, { status: 204 });
};

export const onRequestDelete: PagesFunction<Env> = async ({ params, env, request }) => {
  const denied = unauthorized(request, env);
  if (denied) return denied;

  const id = params.id as string;
  const existing = await env.BUCKET.get(storyKey(id));
  if (existing) {
    const blobKeys = collectBlobKeys(await existing.json());
    if (blobKeys.length) await env.BUCKET.delete(blobKeys);
  }
  await env.BUCKET.delete(storyKey(id));
  return new Response(null, { status: 204 });
};
