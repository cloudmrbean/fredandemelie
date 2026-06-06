/// <reference types="@cloudflare/workers-types" />

interface Env {
  BUCKET: R2Bucket;
  APP_PASSWORD: string;
}

const PREFIX = 'story/';

// List every story. Stories are small JSON objects, so reading each one back is
// fine at wedding scale.
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const stories: unknown[] = [];
  let cursor: string | undefined;

  do {
    const listing = await env.BUCKET.list({ prefix: PREFIX, cursor });
    const objects = await Promise.all(
      listing.objects.map(async o => {
        const body = await env.BUCKET.get(o.key);
        return body ? body.json() : null;
      }),
    );
    for (const s of objects) if (s) stories.push(s);
    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor);

  return Response.json(stories);
};
