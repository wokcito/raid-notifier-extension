import type { Gym } from './types';

declare global {
  interface Window {
    __raidNotifierHookLoaded?: boolean;
  }
  interface XMLHttpRequest {
    __raidNotifier?: { method?: string; url?: string | URL };
  }
}

interface CellsResponseBody {
  data?: {
    realityChannelMapObjectsByS2Cells?: {
      mapObjectsByS2CellsAndTypes?: Array<{
        mapObjectsByType?: Array<{
          type: string;
          mapObjects?: Array<{
            id?: string;
            pgoGym?: { location?: { latitude: number; longitude: number } };
          }>;
        }>;
      }>;
    };
  };
}

interface PreviewCardResponseBody {
  data?: {
    gameMapObjectsByID?: Array<{
      id?: string;
      __typename?: string;
      pgoGym?: { name?: string; imageUrl?: string };
    }>;
  };
}

type CachedGym = Partial<Gym>;

(() => {
  if (window.__raidNotifierHookLoaded) {
    console.warn('[raid-notifier] main-world-hook was already loaded in this frame, not loading it again.');
    return;
  }
  window.__raidNotifierHookLoaded = true;

  const GRAPHQL_URL = 'https://niantic-social-api.nianticlabs.com/graphql';
  const SOURCE = 'raid-notifier-hook';
  const DEBUG = process.env.DEBUG === 'true';

  function post(type: string, payload: Record<string, unknown>): void {
    window.postMessage({ source: SOURCE, type, ...payload }, '*');
  }
  function debug(msg: string): void {
    if (DEBUG) post('debug', { msg });
  }

  const gymCache = new Map<string, CachedGym>();

  function classifyResponseShape(json: unknown): 'cells' | 'preview' | null {
    const data = (json as { data?: Record<string, unknown> } | null)?.data;
    if (!data) return null;
    if (data.realityChannelMapObjectsByS2Cells) return 'cells';
    if ('gameMapObjectsByID' in data) return 'preview';
    return null;
  }

  function handleCellsResponse(body: CellsResponseBody): void {
    const groups = body?.data?.realityChannelMapObjectsByS2Cells?.mapObjectsByS2CellsAndTypes;
    if (!Array.isArray(groups)) {
      debug(`cells response without groups (data=${JSON.stringify(body?.data)?.slice(0, 200)})`);
      return;
    }
    let count = 0;
    for (const group of groups) {
      for (const typeGroup of group.mapObjectsByType ?? []) {
        if (typeGroup.type !== 'PGO_GYM') continue;
        for (const obj of typeGroup.mapObjects ?? []) {
          const loc = obj?.pgoGym?.location;
          if (obj?.id && loc) {
            const existing = gymCache.get(obj.id);
            gymCache.set(obj.id, { ...existing, latitude: loc.latitude, longitude: loc.longitude });
            count++;
          }
        }
      }
    }
    debug(`cells response processed: ${count} gym(s) added to cache, ${gymCache.size} total.`);
  }

  function handlePreviewCardResponse(body: PreviewCardResponseBody): void {
    const entries = body?.data?.gameMapObjectsByID;
    if (!Array.isArray(entries)) {
      debug(`preview response without entries (data=${JSON.stringify(body?.data)?.slice(0, 200)})`);
      return;
    }
    if (entries.length === 0) {
      debug('preview response with 0 entries (click missed every object on the map) -- not reporting anything.');
      return;
    }
    let sawGym = false;
    for (const entry of entries) {
      if (!entry?.id || !entry.pgoGym) {
        debug(`preview -> non-gym object: id=${entry?.id ?? '?'}, __typename=${entry?.__typename ?? '?'}`);
        continue;
      }
      sawGym = true;
      const loc = gymCache.get(entry.id);
      const gym: Gym = {
        scopelyGymId: entry.id,
        name: entry.pgoGym.name ?? null,
        imageUrl: entry.pgoGym.imageUrl ?? null,
        latitude: loc?.latitude ?? null,
        longitude: loc?.longitude ?? null,
      };
      gymCache.set(entry.id, gym);
      debug(`preview -> gym detected: ${gym.name} (id=${entry.id}, cached loc=${!!loc})`);
      post('gym-detected', { gym });
    }
    if (!sawGym) post('non-gym-detected', {});
  }

  function checkRequestForCachedGym(rawBody: unknown): void {
    if (typeof rawBody !== 'string' || gymCache.size === 0) return;
    let match: { id: string; gym: CachedGym } | null = null;
    for (const [id, gym] of gymCache) {
      if (!gym.name) continue;
      if (rawBody.includes(id)) {
        if (match) return;
        match = { id, gym };
      }
    }
    if (match) {
      debug(`gym re-detected from local cache (without waiting for network): ${match.gym.name}`);
      const gym: Gym = {
        scopelyGymId: match.id,
        name: match.gym.name ?? null,
        imageUrl: match.gym.imageUrl ?? null,
        latitude: match.gym.latitude ?? null,
        longitude: match.gym.longitude ?? null,
      };
      post('gym-detected', { gym });
    }
  }

  function handleResponseText(jsonText: string): void {
    let json: unknown;
    try {
      json = JSON.parse(jsonText);
    } catch (e) {
      debug(`error parsing graphql response: ${e instanceof Error ? e.message : e}`);
      return;
    }
    const kind = classifyResponseShape(json);
    if (kind === 'cells') return handleCellsResponse(json as CellsResponseBody);
    if (kind === 'preview') return handlePreviewCardResponse(json as PreviewCardResponseBody);
    const data = (json as { data?: Record<string, unknown> } | null)?.data;
    debug(`unrecognized graphql response (data keys=${data ? Object.keys(data).join(',') : '(no data)'})`);
  }

  // ---- fetch ----
  const originalFetch = window.fetch;
  window.fetch = async function (this: typeof window, ...args: Parameters<typeof fetch>): Promise<Response> {
    const response = await originalFetch.apply(this, args);
    try {
      const [request, init] = args;
      const url = typeof request === 'string' ? request : (request as { url?: string })?.url;
      const method = (
        init?.method ?? (typeof request === 'object' ? (request as { method?: string })?.method : 'GET')
      )?.toUpperCase();
      if (url?.startsWith(GRAPHQL_URL) && method === 'POST') {
        const rawBody =
          init?.body ?? (typeof request === 'object' ? await (request as Request).clone().text() : undefined);
        checkRequestForCachedGym(rawBody);
        response
          .clone()
          .text()
          .then(handleResponseText)
          .catch((e) => debug(`error reading fetch response: ${e instanceof Error ? e.message : e}`));
      }
    } catch (e) {
      debug(`error in fetch hook: ${e instanceof Error ? e.message : e}`);
    }
    return response;
  };

  // ---- XMLHttpRequest ----
  const OriginalXHR = window.XMLHttpRequest;
  const originalOpen = OriginalXHR.prototype.open;
  const originalSend = OriginalXHR.prototype.send;

  OriginalXHR.prototype.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ): void {
    this.__raidNotifier = { method: method?.toUpperCase(), url };
    return (originalOpen as (...a: unknown[]) => void).call(this, method, url, ...rest);
  };

  OriginalXHR.prototype.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null): void {
    const meta = this.__raidNotifier;
    if (meta && meta.method === 'POST' && typeof meta.url === 'string' && meta.url.startsWith(GRAPHQL_URL)) {
      checkRequestForCachedGym(body);
      this.addEventListener('load', () => handleResponseText(this.responseText));
    }
    return originalSend.call(this, body as XMLHttpRequestBodyInit | null | undefined);
  };

  post('hook-ready', {});
})();
