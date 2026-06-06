/// <reference types="@cloudflare/workers-types" />

interface Env {
  APP_PASSWORD: string;
}

// Validates an editor password so the client can unlock the edit UI without
// performing a real write. Returns 204 on match, 401 otherwise.
export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const provided = request.headers.get('x-app-password');
  if (!env.APP_PASSWORD || provided !== env.APP_PASSWORD) {
    return new Response('Unauthorized', { status: 401 });
  }
  return new Response(null, { status: 204 });
};
