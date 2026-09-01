import type { ExtensionRequest, Gym, RequestResponseMap } from './types';

declare global {
  interface Window {
    __raidNotifierContentLoaded?: boolean;
  }
}

(() => {
  if (window.__raidNotifierContentLoaded) {
    console.warn('[raid-notifier] content script was already loaded in this frame, not loading it again.');
    return;
  }
  window.__raidNotifierContentLoaded = true;

  const SOURCE = 'raid-notifier-hook';

  const FREE_TIER_WATCH_LIMIT = 3;
  const PREMIUM_TIER_WATCH_LIMIT = 50;

  function hasLocation(gym: Gym): boolean {
    return typeof gym.latitude === 'number' && typeof gym.longitude === 'number';
  }

  let panel: HTMLDivElement | null = null;
  let currentGym: Gym | null = null;
  let pendingGymId: string | null = null;

  let hasSession: boolean | null = null;

  async function checkSession(): Promise<boolean> {
    try {
      const { session } = await chrome.storage.local.get('session');
      hasSession = !!session;
    } catch (e) {
      console.error('[raid-notifier] could not read the session, showing the panel anyway:', e);
      hasSession = true;
    }
    return hasSession;
  }
  checkSession();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !('session' in changes)) return;
    hasSession = !!changes.session.newValue;
    if (!hasSession) hidePanel('session ended');
  });

  let isPremium: boolean | null = null;

  chrome.storage.local
    .get('isPremium')
    .then(({ isPremium: stored }) => {
      if (typeof stored === 'boolean') {
        isPremium = stored;
        renderButton();
      }
      sendMessageSafe({ type: 'GET_ACCOUNT_INFO' });
    })
    .catch((e) => console.error('[raid-notifier] could not read isPremium from cache:', e));

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !('isPremium' in changes)) return;
    isPremium = !!changes.isPremium.newValue;
    renderButton();
  });

  function currentWatchLimit(): number {
    return isPremium ? PREMIUM_TIER_WATCH_LIMIT : FREE_TIER_WATCH_LIMIT;
  }

  let watchedSet = new Set<string>();

  chrome.storage.local
    .get('watchedGymIds')
    .then(({ watchedGymIds }) => {
      if (Array.isArray(watchedGymIds)) {
        watchedSet = new Set(watchedGymIds);
        renderButton();
      }
      sendMessageSafe({ type: 'LIST_WATCHED' });
    })
    .catch((e) => console.error('[raid-notifier] could not read watchedGymIds from cache:', e));

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.watchedGymIds) return;
    const newValue: unknown = changes.watchedGymIds.newValue;
    watchedSet = new Set<string>(Array.isArray(newValue) ? newValue : []);
    renderButton();
  });

  function renderButton(): void {
    if (!panel || !currentGym || panel.style.display === 'none') return;
    const btn = panel.querySelector<HTMLButtonElement>('[data-raid-notifier-button]');
    if (!btn) return;
    if (pendingGymId === currentGym.scopelyGymId) {
      btn.disabled = true;
      btn.style.opacity = '0.5';
      btn.style.cursor = 'not-allowed';
      btn.textContent = '…';
      return;
    }
    if (!hasLocation(currentGym)) {
      btn.disabled = true;
      btn.style.opacity = '0.5';
      btn.style.cursor = 'not-allowed';
      btn.textContent = '📍 Waiting for location…';
      btn.style.background = '#4b5563';
      return;
    }
    const watched = watchedSet.has(currentGym.scopelyGymId);
    const limit = currentWatchLimit();
    if (isPremium !== null && !watched && watchedSet.size >= limit) {
      btn.disabled = true;
      btn.style.opacity = '0.5';
      btn.style.cursor = 'not-allowed';
      btn.textContent = `Limit (${limit}) reached`;
      btn.style.background = '#4b5563';
      return;
    }
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.style.cursor = 'pointer';
    setButtonState(btn, watched);
  }

  const MESSAGE_TIMEOUT_MS = 6000;
  function sendMessageSafe<T extends ExtensionRequest>(
    message: T,
  ): Promise<RequestResponseMap[T['type']]> {
    type Result = RequestResponseMap[T['type']];
    return new Promise((resolve) => {
      const timeout = setTimeout(
        () => resolve({ ok: false, error: 'Timed out waiting for a response from the extension.' } as Result),
        MESSAGE_TIMEOUT_MS,
      );
      try {
        chrome.runtime.sendMessage(message, (response: Result | undefined) => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message } as Result);
            return;
          }
          resolve(response ?? ({ ok: false, error: 'Empty response from the extension.' } as Result));
        });
      } catch (e) {
        clearTimeout(timeout);
        const msg = e instanceof Error ? e.message : String(e);
        resolve({ ok: false, error: `${msg} (try reloading the pokemongo.com tab)` } as Result);
      }
    });
  }

  function ensurePanel(): HTMLDivElement {
    if (panel) return panel;
    panel = document.createElement('div');
    panel.dataset.raidNotifierPanel = 'true';
    Object.assign(panel.style, {
      position: 'fixed',
      left: '16px',
      bottom: '16px',
      zIndex: '2147483647',
      background: '#111827',
      color: '#fff',
      padding: '10px 14px',
      borderRadius: '10px',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '13px',
      boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      maxWidth: '320px',
    });

    const label = document.createElement('span');
    label.dataset.raidNotifierLabel = 'true';
    label.textContent = 'Tap a gym on the map…';

    const btn = document.createElement('button');
    btn.dataset.raidNotifierButton = 'true';
    Object.assign(btn.style, {
      padding: '6px 12px',
      borderRadius: '6px',
      border: 'none',
      color: '#fff',
      fontSize: '13px',
      cursor: 'pointer',
      flexShrink: '0',
    });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onWatchButtonClick();
    });

    panel.appendChild(label);
    panel.appendChild(btn);
    document.body.appendChild(panel);
    return panel;
  }

  function setButtonState(btn: HTMLButtonElement, watched: boolean): void {
    if (watched) {
      btn.textContent = '🗑 Stop watching';
      btn.style.background = '#dc2626';
    } else {
      btn.textContent = '⭐ Watch';
      btn.style.background = '#2563eb';
    }
  }

  async function onWatchButtonClick(): Promise<void> {
    if (!currentGym || pendingGymId) return;
    if (!hasLocation(currentGym)) return;
    const gym = currentGym;
    const wasWatched = watchedSet.has(gym.scopelyGymId);
    if (isPremium !== null && !wasWatched && watchedSet.size >= currentWatchLimit()) return;
    pendingGymId = gym.scopelyGymId;
    renderButton();

    const response = wasWatched
      ? await sendMessageSafe({ type: 'UNWATCH_GYM', scopelyGymId: gym.scopelyGymId })
      : await sendMessageSafe({ type: 'WATCH_GYM', gym });

    pendingGymId = null;

    if (!response.ok) {
      console.error('[raid-notifier]', response.error);
      if (currentGym?.scopelyGymId === gym.scopelyGymId) {
        const btn = panel?.querySelector<HTMLButtonElement>('[data-raid-notifier-button]');
        if (btn) {
          btn.textContent = '⚠ error (see console)';
          setTimeout(renderButton, 2000);
        }
      }
      return;
    }

    watchedSet[wasWatched ? 'delete' : 'add'](gym.scopelyGymId);
    renderButton();
  }

  function hidePanel(reason?: string): void {
    if (panel && panel.style.display !== 'none') {
      console.log(`[raid-notifier] hiding panel (reason: ${reason ?? '?'})`);
    }
    if (panel) panel.style.display = 'none';
    currentGym = null;
  }

  const discoveredGymIds = new Set<string>();

  async function onGymDetected(gym: Gym): Promise<void> {
    try {
      if (!gym.scopelyGymId) return;
      if (hasSession === null) await checkSession();
      if (!hasSession) return;

      if (gym.name && hasLocation(gym) && !discoveredGymIds.has(gym.scopelyGymId)) {
        discoveredGymIds.add(gym.scopelyGymId);
        sendMessageSafe({ type: 'DISCOVER_GYM', gym }).then((res) => {
          if (!res.ok) console.error('[raid-notifier] could not report the discovered gym:', res.error);
        });
      }

      currentGym = gym;

      const p = ensurePanel();
      p.style.display = 'flex';
      const label = p.querySelector<HTMLSpanElement>('[data-raid-notifier-label]');
      if (label) {
        label.textContent = gym.name ? gym.name : `unnamed gym (${gym.scopelyGymId.slice(0, 12)}…)`;
      }
      renderButton();
    } catch (e) {
      console.error('[raid-notifier] onGymDetected blew up:', e, 'gym:', gym);
    }
  }

  const DRAG_THRESHOLD_PX = 8;
  let mouseDownAt: { x: number; y: number } | null = null;
  window.addEventListener(
    'mousedown',
    (event) => {
      mouseDownAt = { x: event.clientX, y: event.clientY };
    },
    true,
  );
  window.addEventListener(
    'click',
    (event) => {
      if (panel && event.target instanceof Node && panel.contains(event.target)) return;
      if (mouseDownAt) {
        const dist = Math.hypot(event.clientX - mouseDownAt.x, event.clientY - mouseDownAt.y);
        mouseDownAt = null;
        if (dist > DRAG_THRESHOLD_PX) return;
      }
      hidePanel('real click on the map (shows again if it turns out to be a gym)');
    },
    true,
  );

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data as { source?: string; type?: string; gym?: Gym } | null;
    if (!data || data.source !== SOURCE) return;

    if (data.type === 'debug') {
      console.log('[raid-notifier][debug]', (data as { msg?: string }).msg);
    }
    if (data.type === 'gym-detected' && data.gym) {
      onGymDetected(data.gym);
    }
    if (data.type === 'non-gym-detected') {
      hidePanel('a non-gym object was selected');
    }
  });
})();
