/// <reference types="@cloudflare/workers-types" />
import { AwsClient } from 'aws4fetch';

interface Env {
  APP_PASSWORD: string;
  R2_ACCOUNT_ID: string;
  R2_BUCKET_NAME: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
}

function unauthorized(request: Request, env: Env): Response | null {
  const provided = request.headers.get('x-app-password');
  if (!env.APP_PASSWORD || provided !== env.APP_PASSWORD) {
    return new Response('Unauthorized', { status: 401 });
  }
  return null;
}

const EXPIRES_SECONDS = 3600;

// Hands back a short-lived presigned URL so the browser can upload a blob
// straight to R2, bypassing the ~100MB request-body limit on Pages Functions.
// Password-gated so only editors can mint upload URLs.
export const onRequestPost: PagesFunction<Env> = async ({ params, env, request }) => {
  const denied = unauthorized(request, env);
  if (denied) return denied;

  if (!env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_ACCOUNT_ID) {
    return new Response('R2 credentials are not configured.', { status: 500 });
  }

  const key = params.key as string;
  const client = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: 's3',
    region: 'auto',
  });

  const endpoint = new URL(
    `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_NAME}/${encodeURIComponent(key)}`,
  );
  endpoint.searchParams.set('X-Amz-Expires', String(EXPIRES_SECONDS));

  // signQuery puts the signature in the query string and signs only `host`, so
  // the browser is free to send its own Content-Type on the upload PUT.
  const signed = await client.sign(endpoint.toString(), {
    method: 'PUT',
    aws: { signQuery: true },
  });

  return Response.json({ url: signed.url, expiresIn: EXPIRES_SECONDS });
};
