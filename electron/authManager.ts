import { app, BrowserWindow, ipcMain, net, shell } from 'electron';
import path from 'path';
import log from 'electron-log';
import { startDeviceAuthorization, pollDeviceToken, DeviceAuthError, type TokenResponse } from './deviceAuth';

const PULSE_ACCOUNTS_ISSUER = process.env.PULSE_ACCOUNTS_ISSUER || 'https://accounts.pulsesystems.dev';
const DEVICE_CLIENT_ID = 'pulsemdt-desktop';
const DEVICE_SCOPE = 'openid profile email accounts:read discord:guilds:read';

function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function hasActiveSession(serverUrl: string): Promise<boolean> {
  try {
    const res = await net.fetch(`${serverUrl}/api/auth/session`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return false;
    const body = (await res.json().catch(() => null)) as { user?: unknown } | null;
    return !!body?.user;
  } catch (err) {
    log.warn('[AuthManager] Session check failed:', err);
    return false;
  }
}

async function exchangeForSession(serverUrl: string, tokens: TokenResponse): Promise<boolean> {
  try {
    const csrfRes = await net.fetch(`${serverUrl}/api/auth/csrf`);
    const csrfBody = (await csrfRes.json().catch(() => null)) as { csrfToken?: string } | null;
    if (!csrfBody?.csrfToken) {
      log.error('[AuthManager] Could not obtain CSRF token from server');
      return false;
    }

    const body = new URLSearchParams({
      csrfToken: csrfBody.csrfToken,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? '',
      expiresIn: String(tokens.expiresIn),
      scope: tokens.scope,
      callbackUrl: `${serverUrl}/access-center`,
    });

    const res = await net.fetch(`${serverUrl}/api/auth/callback/desktop-device`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Auth-Return-Redirect': '1',
      },
      body,
    });
    const data = (await res.json().catch(() => null)) as { url?: string } | null;
    if (!res.ok || !data?.url) {
      log.error('[AuthManager] Session exchange failed with status', res.status);
      return false;
    }
    const error = new URL(data.url).searchParams.get('error');
    if (error) {
      log.error('[AuthManager] Session exchange rejected:', error);
      return false;
    }
    return true;
  } catch (err) {
    log.error('[AuthManager] Session exchange threw:', err);
    return false;
  }
}

let activeSignIn: Promise<boolean> | null = null;

export function ensureSignedIn(serverUrl: string): Promise<boolean> {
  if (!activeSignIn) {
    activeSignIn = runSignInFlow(serverUrl).finally(() => {
      activeSignIn = null;
    });
  }
  return activeSignIn;
}

async function runSignInFlow(serverUrl: string): Promise<boolean> {
  if (await hasActiveSession(serverUrl)) return true;

  return new Promise<boolean>((resolve) => {
    let cancelled = false;
    let settled = false;

    const win = new BrowserWindow({
      width: 480,
      height: 480,
      resizable: false,
      frame: false,
      titleBarStyle: 'hidden',
      backgroundColor: '#14151a',
      show: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload-signin.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    win.setTitle('Sign in to PulseMDT');

    const cleanup = () => {
      ipcMain.removeHandler('signin:cancel');
      ipcMain.removeHandler('signin:open-link');
      ipcMain.removeHandler('signin:retry');
    };
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(ok);
      if (!win.isDestroyed()) win.close();
    };

    ipcMain.handle('signin:cancel', () => {
      cancelled = true;
      finish(false);
    });
    ipcMain.handle('signin:open-link', (_e, url: string) => {
      if (isHttpUrl(url)) void shell.openExternal(url);
    });
    ipcMain.handle('signin:retry', () => {
      if (!cancelled && !win.isDestroyed()) void beginDeviceFlow();
    });

    win.on('closed', () => {
      cancelled = true;
      finish(false);
    });

    const resourcesPath = app.isPackaged
      ? path.join(process.resourcesPath, 'resources')
      : path.join(__dirname, '../../resources');
    win.loadFile(path.join(resourcesPath, 'signin.html'));

    win.webContents.once('did-finish-load', () => {
      void beginDeviceFlow();
    });

    async function beginDeviceFlow() {
      try {
        const device = await startDeviceAuthorization(PULSE_ACCOUNTS_ISSUER, DEVICE_CLIENT_ID, DEVICE_SCOPE);
        if (cancelled || win.isDestroyed()) return;
        log.info(`[AuthManager] Device code issued: ${device.userCode} (expires ${new Date(device.expiresAt).toISOString()})`);

        win.webContents.send('signin:code', {
          userCode: device.userCode,
          verificationUri: device.verificationUri,
          verificationUriComplete: device.verificationUriComplete,
        });
        void shell.openExternal(device.verificationUriComplete).catch((err) => {
          log.warn('[AuthManager] Failed to auto-open verification URL:', err);
        });

        let intervalMs = device.intervalSeconds * 1000;
        while (!cancelled && !win.isDestroyed() && Date.now() < device.expiresAt) {
          await delay(intervalMs);
          if (cancelled || win.isDestroyed()) return;

          const result = await pollDeviceToken(PULSE_ACCOUNTS_ISSUER, DEVICE_CLIENT_ID, device.deviceCode);
          if (cancelled || win.isDestroyed()) return;

          if ('pending' in result) continue;
          if ('slowDown' in result) {
            intervalMs += 5000;
            continue;
          }

          log.info('[AuthManager] Device authorized, exchanging for a session');
          if (!win.isDestroyed()) win.webContents.send('signin:status', { state: 'authorized' });
          const ok = await exchangeForSession(serverUrl, result);
          log.info(`[AuthManager] Session exchange ${ok ? 'succeeded' : 'failed'}`);
          if (!ok && !win.isDestroyed()) {
            win.webContents.send('signin:status', { state: 'error', message: 'Signed in to Pulse Accounts, but PulseMDT could not start your session. Try again.' });
          }
          finish(ok);
          return;
        }

        if (!cancelled && !win.isDestroyed()) {
          win.webContents.send('signin:status', { state: 'expired' });
        }
      } catch (err) {
        if (cancelled || win.isDestroyed()) return;
        if (err instanceof DeviceAuthError && (err.code === 'access_denied' || err.code === 'expired_token')) {
          win.webContents.send('signin:status', { state: err.code === 'access_denied' ? 'denied' : 'expired' });
        } else {
          log.error('[AuthManager] Device sign-in failed:', err);
          win.webContents.send('signin:status', { state: 'error', message: err instanceof Error ? err.message : String(err) });
        }
      }
    }
  });
}
