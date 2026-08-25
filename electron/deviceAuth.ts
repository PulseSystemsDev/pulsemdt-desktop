export interface DeviceAuthorizationResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresAt: number;
  intervalSeconds: number;
}

export class DeviceAuthError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'DeviceAuthError';
  }
}

function normalizeIssuer(issuer: string): string {
  return issuer.endsWith('/') ? issuer.slice(0, -1) : issuer;
}

export async function startDeviceAuthorization(issuer: string, clientId: string, scope: string): Promise<DeviceAuthorizationResponse> {
  const res = await fetch(`${normalizeIssuer(issuer)}/device/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, scope }),
  });

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new DeviceAuthError(typeof body.error_description === 'string' ? body.error_description : 'Could not start device sign-in.', typeof body.error === 'string' ? body.error : 'unknown_error');
  }

  const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : 600;
  return {
    deviceCode: String(body.device_code),
    userCode: String(body.user_code),
    verificationUri: String(body.verification_uri),
    verificationUriComplete: String(body.verification_uri_complete ?? body.verification_uri),
    expiresAt: Date.now() + expiresIn * 1000,
    intervalSeconds: typeof body.interval === 'number' ? body.interval : 5,
  };
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  scope: string;
}

export async function pollDeviceToken(issuer: string, clientId: string, deviceCode: string): Promise<TokenResponse | { pending: true } | { slowDown: true }> {
  const res = await fetch(`${normalizeIssuer(issuer)}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: deviceCode,
      client_id: clientId,
    }),
  });

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (res.ok) {
    return {
      accessToken: String(body.access_token),
      refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : null,
      expiresIn: typeof body.expires_in === 'number' ? body.expires_in : 600,
      scope: typeof body.scope === 'string' ? body.scope : '',
    };
  }

  const error = typeof body.error === 'string' ? body.error : 'unknown_error';
  if (error === 'authorization_pending') return { pending: true };
  if (error === 'slow_down') return { slowDown: true };
  throw new DeviceAuthError(typeof body.error_description === 'string' ? body.error_description : error, error);
}
