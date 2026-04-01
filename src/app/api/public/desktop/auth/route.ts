import { NextResponse } from 'next/server';
import { getPublicApiBaseUrl } from '@/lib/public-runtime-config';

export async function GET(request: Request) {
  return NextResponse.json({
    deployment_base_url: new URL(request.url).origin,
    api_base_url: getPublicApiBaseUrl(),
  });
}
