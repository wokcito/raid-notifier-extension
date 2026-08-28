import { RAID_NOTIFIER_CONFIG } from './config';
import type {
  AccountInfo,
  ApiResult,
  BillingOrder,
  BillingPackagesInfo,
  ExtensionRequest,
  Gym,
  Session,
  UpdateStatus,
  WatchedGymSummary,
} from './types';

const { API_BASE_URL, SUPABASE_URL, SUPABASE_ANON_KEY } = RAID_NOTIFIER_CONFIG;

const GITHUB_REPO = 'wokcito/raid-notifier-extension';

let watchedGymIds: Set<string> | null = null;

async function persistWatchedIds(): Promise<void> {
  await chrome.storage.local.set({ watchedGymIds: [...(watchedGymIds ?? [])] });
}

async function getSession(): Promise<Session | null> {
  const { session } = await chrome.storage.local.get('session');
  return (session as Session | undefined) ?? null;
}

const SESSION_REFRESH_BUFFER_MS = 60 * 1000;

let refreshPromise: Promise<Session | null> | null = null;

async function refreshAccessToken(session: Session): Promise<Session | null> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
        body: JSON.stringify({ refresh_token: session.refreshToken }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.access_token) return null;
      const refreshed: Session = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? session.refreshToken,
        expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
        email: session.email,
      };
      await chrome.storage.local.set({ session: refreshed });
      return refreshed;
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

async function getValidSession(): Promise<Session | null> {
  const session = await getSession();
  if (!session) return null;
  if (Date.now() < session.expiresAt - SESSION_REFRESH_BUFFER_MS) return session;
  const refreshed = await refreshAccessToken(session);
  if (refreshed) return refreshed;
  await logout();
  return null;
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<ApiResult<T>> {
  const session = await getValidSession();
  if (!session) {
    return { ok: false, error: 'No session found. Open the extension and log in first.' };
  }
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
        ...options.headers,
      },
    });
    if (res.status === 401) {
      await logout();
      return { ok: false, error: 'Your session expired. Log in again.' };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `${res.status} ${res.statusText}: ${text.slice(0, 200)}` };
    }
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    return { ok: true, data: data as T };
  } catch (e) {
    return { ok: false, error: `Network error: ${e instanceof Error ? e.message : e}` };
  }
}

async function refreshWatchedList(): Promise<ApiResult<WatchedGymSummary[]>> {
  const result = await apiFetch<WatchedGymSummary[]>('/gyms/watched');
  if (!result.ok) return result;
  const list = Array.isArray(result.data) ? result.data : [];
  watchedGymIds = new Set(list.map((g) => g.scopelyGymId));
  await persistWatchedIds();
  return { ok: true, data: list };
}

async function refreshAccountInfo(): Promise<ApiResult<AccountInfo>> {
  const result = await apiFetch<Partial<AccountInfo>>('/user/me');
  if (!result.ok) return result;
  const isPremium = !!result.data?.isPremium;
  const premiumUntil = result.data?.premiumUntil ?? null;
  const linkedChannels = Array.isArray(result.data?.linkedChannels) ? result.data.linkedChannels : [];
  await chrome.storage.local.set({ isPremium, premiumUntil, linkedChannels });
  return { ok: true, data: { isPremium, premiumUntil, linkedChannels } };
}

async function syncTimezone(): Promise<ApiResult<undefined>> {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return apiFetch('/user/me', { method: 'PATCH', body: JSON.stringify({ timezone }) });
}

async function storeSession(data: any, fallbackEmail: string): Promise<void> {
  const session: Session = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    email: data.user?.email ?? fallbackEmail,
  };
  await chrome.storage.local.set({ session });
  watchedGymIds = null;
  await Promise.all([refreshWatchedList(), refreshAccountInfo(), syncTimezone()]);
}

async function login(email: string, password: string): Promise<ApiResult<undefined>> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: data.error_description || data.msg || 'Login failed.' };
  }
  await storeSession(data, email);
  return { ok: true, data: undefined };
}

async function signup(email: string, password: string): Promise<ApiResult<{ needsConfirmation: boolean }>> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: data.error_description || data.msg || 'Sign up failed.' };
  }
  if (!data.access_token) {
    return { ok: true, data: { needsConfirmation: true } };
  }
  await storeSession(data, email);
  return { ok: true, data: { needsConfirmation: false } };
}

function parseVersion(raw: string): [number, number, number] {
  const clean = raw.replace(/^v/, '').split('-')[0];
  const parts = clean.split('.').map((n) => parseInt(n, 10) || 0);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

function isNewer(a: [number, number, number], b: [number, number, number]): boolean {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

let updateStatusCache: { data: UpdateStatus; fetchedAt: number } | null = null;
const UPDATE_CHECK_CACHE_MS = 5 * 60 * 1000;

async function checkForUpdate(): Promise<ApiResult<UpdateStatus>> {
  if (updateStatusCache && Date.now() - updateStatusCache.fetchedAt < UPDATE_CHECK_CACHE_MS) {
    return { ok: true, data: updateStatusCache.data };
  }
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);
    if (!res.ok) {
      return { ok: false, error: `${res.status} ${res.statusText}` };
    }
    const data = await res.json();
    const latestVersion: string = data.tag_name ?? '';
    const releaseUrl: string = data.html_url ?? `https://github.com/${GITHUB_REPO}/releases`;
    const current = parseVersion(chrome.runtime.getManifest().version);
    const latest = parseVersion(latestVersion);
    const updateAvailable = isNewer(latest, current);
    const breaking = updateAvailable && latest[0] > current[0];
    const status: UpdateStatus = { updateAvailable, breaking, latestVersion, releaseUrl };
    updateStatusCache = { data: status, fetchedAt: Date.now() };
    return { ok: true, data: status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function createBillingOrder(packageMonths: number, method: string): Promise<ApiResult<BillingOrder>> {
  return apiFetch('/billing/orders', {
    method: 'POST',
    body: JSON.stringify({ packageMonths, method }),
  });
}

async function getBillingOrder(orderId: number): Promise<ApiResult<BillingOrder>> {
  return apiFetch(`/billing/orders/${orderId}`);
}

async function getBillingPackages(): Promise<ApiResult<BillingPackagesInfo>> {
  return apiFetch('/billing/packages');
}

async function logout(): Promise<void> {
  await chrome.storage.local.remove(['session', 'watchedGymIds', 'isPremium', 'linkedChannels']);
  watchedGymIds = null;
}

chrome.runtime.onMessage.addListener((message: ExtensionRequest, _sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {
        case 'LOGIN': {
          sendResponse(await login(message.email, message.password));
          break;
        }
        case 'SIGNUP': {
          sendResponse(await signup(message.email, message.password));
          break;
        }
        case 'LOGOUT': {
          await logout();
          sendResponse({ ok: true, data: undefined });
          break;
        }
        case 'GET_SESSION': {
          sendResponse({ ok: true, session: await getSession() });
          break;
        }
        case 'LIST_WATCHED': {
          sendResponse(await refreshWatchedList());
          break;
        }
        case 'GET_ACCOUNT_INFO': {
          sendResponse(await refreshAccountInfo());
          break;
        }
        case 'CREATE_TELEGRAM_LINK_CODE': {
          sendResponse(await apiFetch('/notifications/telegram/link-code', { method: 'POST' }));
          break;
        }
        case 'WATCH_GYM': {
          const gym: Gym = message.gym;
          const result = await apiFetch('/gyms/watch-by-scopely-id', {
            method: 'POST',
            body: JSON.stringify(gym),
          });
          if (result.ok) {
            (watchedGymIds ?? (watchedGymIds = new Set())).add(gym.scopelyGymId);
            await persistWatchedIds();
          }
          sendResponse(result);
          break;
        }
        case 'UNWATCH_GYM': {
          const result = await apiFetch(
            `/gyms/watch-by-scopely-id/${encodeURIComponent(message.scopelyGymId)}`,
            { method: 'DELETE' },
          );
          if (result.ok) {
            watchedGymIds?.delete(message.scopelyGymId);
            await persistWatchedIds();
          }
          sendResponse(result);
          break;
        }
        case 'DISCOVER_GYM': {
          sendResponse(
            await apiFetch('/gyms/discover-by-scopely-id', {
              method: 'POST',
              body: JSON.stringify(message.gym),
            }),
          );
          break;
        }
        case 'CHECK_FOR_UPDATE': {
          sendResponse(await checkForUpdate());
          break;
        }
        case 'CREATE_BILLING_ORDER': {
          sendResponse(await createBillingOrder(message.packageMonths, message.method));
          break;
        }
        case 'GET_BILLING_ORDER': {
          sendResponse(await getBillingOrder(message.orderId));
          break;
        }
        case 'GET_BILLING_PACKAGES': {
          sendResponse(await getBillingPackages());
          break;
        }
        default: {
          const exhaustive: never = message;
          sendResponse({ ok: false, error: `Unknown message: ${JSON.stringify(exhaustive)}` });
        }
      }
    } catch (e) {
      console.error('[raid-notifier][background]', message.type, e);
      sendResponse({ ok: false, error: `Internal error: ${e instanceof Error ? e.message : e}` });
    }
  })();
  return true;
});
