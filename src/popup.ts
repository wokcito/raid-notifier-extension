import qrcode from 'qrcode-generator';
import type {
  AccountInfo,
  ExtensionRequest,
  NotificationChannel,
  RequestResponseMap,
  WatchedGymSummary,
} from './types';

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element #${id} in popup.html`);
  return found as T;
}

const loadingEl = el<HTMLDivElement>('loading');
const loginForm = el<HTMLFormElement>('login-form');
const loggedInView = el<HTMLDivElement>('logged-in');
const accountEmailEl = el<HTMLSpanElement>('account-email');
const accountPlanEl = el<HTMLSpanElement>('account-plan');
const watchedListEl = el<HTMLUListElement>('watched-list');
const watchedEmptyEl = el<HTMLDivElement>('watched-empty');
const statusEl = el<HTMLDivElement>('status');
const telegramLinkedEl = el<HTMLSpanElement>('telegram-linked');
const telegramLinkBtnEl = el<HTMLButtonElement>('telegram-link-btn');
const telegramActionsEl = el<HTMLDivElement>('telegram-actions');
const telegramOpenLinkEl = el<HTMLAnchorElement>('telegram-open-link');
const telegramCopyBtnEl = el<HTMLButtonElement>('telegram-copy-btn');
const telegramQrBtnEl = el<HTMLButtonElement>('telegram-qr-btn');
const telegramQrEl = el<HTMLDivElement>('telegram-qr');
const telegramHintEl = el<HTMLDivElement>('telegram-hint');
const loginBtnEl = el<HTMLButtonElement>('login');
const versionEl = el<HTMLSpanElement>('version');
versionEl.textContent = `v${chrome.runtime.getManifest().version}`;
const authToggleTextEl = el<HTMLSpanElement>('auth-toggle-text');
const toggleModeEl = el<HTMLAnchorElement>('toggle-mode');
const updateBannerEl = el<HTMLDivElement>('update-banner');
const emailInputEl = el<HTMLInputElement>('email');
const passwordInputEl = el<HTMLInputElement>('password');

const MESSAGE_TIMEOUT_MS = 6000;
function sendMessageSafe<T extends ExtensionRequest>(message: T): Promise<RequestResponseMap[T['type']]> {
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
      resolve({ ok: false, error: e instanceof Error ? e.message : String(e) } as Result);
    }
  });
}

function setStatus(text?: string): void {
  statusEl.textContent = text ?? '';
}

function renderWatchedList(gyms: WatchedGymSummary[]): void {
  watchedListEl.innerHTML = '';
  watchedEmptyEl.style.display = gyms.length === 0 ? 'block' : 'none';
  for (const gym of gyms) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = gym.name || `unnamed gym (${gym.scopelyGymId.slice(0, 10)}…)`;
    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', async () => {
      removeBtn.disabled = true;
      const res = await sendMessageSafe({ type: 'UNWATCH_GYM', scopelyGymId: gym.scopelyGymId });
      if (res.ok) {
        li.remove();
        if (watchedListEl.children.length === 0) watchedEmptyEl.style.display = 'block';
      } else {
        setStatus(res.error);
        removeBtn.disabled = false;
      }
    });
    li.appendChild(name);
    li.appendChild(removeBtn);
    watchedListEl.appendChild(li);
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

function renderAccountPlan(info: AccountInfo): void {
  if (info.isPremium && info.premiumUntil) {
    accountPlanEl.textContent = `Premium · until ${formatDate(info.premiumUntil)}`;
  } else {
    accountPlanEl.textContent = info.isPremium ? 'Premium' : 'Free';
  }
  accountPlanEl.className = info.isPremium ? 'premium' : 'free';
}

function renderNotifications(linkedChannels: NotificationChannel[]): void {
  const telegramLinked = linkedChannels.includes('TELEGRAM');
  telegramLinkedEl.style.display = telegramLinked ? 'inline' : 'none';
  telegramLinkBtnEl.style.display = telegramLinked ? 'none' : 'inline-block';
  telegramActionsEl.style.display = 'none';
  telegramQrEl.style.display = 'none';
  telegramHintEl.style.display = 'none';
}

telegramLinkBtnEl.addEventListener('click', async () => {
  telegramLinkBtnEl.disabled = true;
  telegramLinkBtnEl.textContent = 'Linking…';
  const res = await sendMessageSafe({ type: 'CREATE_TELEGRAM_LINK_CODE' });
  if (res.ok && res.data?.deepLink) {
    telegramOpenLinkEl.setAttribute('href', res.data.deepLink);
    telegramLinkBtnEl.style.display = 'none';
    telegramActionsEl.style.display = 'flex';
    telegramHintEl.style.display = 'block';
  } else {
    console.error('[raid-notifier]', !res.ok ? res.error : '(no deepLink)');
    setStatus("Couldn't generate the Telegram link. See the console for details.");
    telegramLinkBtnEl.disabled = false;
    telegramLinkBtnEl.textContent = 'Link';
  }
});

telegramCopyBtnEl.addEventListener('click', async () => {
  const link = telegramOpenLinkEl.getAttribute('href');
  if (!link || link === '#') return;
  try {
    await navigator.clipboard.writeText(link);
    const original = telegramCopyBtnEl.textContent;
    telegramCopyBtnEl.textContent = 'Copied!';
    setTimeout(() => {
      telegramCopyBtnEl.textContent = original;
    }, 1500);
  } catch (e) {
    console.error('[raid-notifier] could not copy the Telegram link:', e);
  }
});

telegramQrBtnEl.addEventListener('click', () => {
  const link = telegramOpenLinkEl.getAttribute('href');
  if (!link || link === '#') return;
  const showing = telegramQrEl.style.display !== 'none';
  if (showing) {
    telegramQrEl.style.display = 'none';
    telegramQrBtnEl.textContent = 'Show QR code';
    return;
  }
  if (telegramQrEl.dataset.renderedFor !== link) {
    const qr = qrcode(0, 'M');
    qr.addData(link);
    qr.make();
    telegramQrEl.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    telegramQrEl.dataset.renderedFor = link;
  }
  telegramQrEl.style.display = 'block';
  telegramQrBtnEl.textContent = 'Hide QR code';
});

let authMode: 'login' | 'signup' = 'login';

function updateAuthModeUI(): void {
  const isSignup = authMode === 'signup';
  loginBtnEl.textContent = isSignup ? 'Sign up' : 'Log in';
  authToggleTextEl.textContent = isSignup ? 'Already have an account? ' : "Don't have an account? ";
  toggleModeEl.textContent = isSignup ? 'Log in' : 'Sign up';
}

toggleModeEl.addEventListener('click', (e) => {
  e.preventDefault();
  authMode = authMode === 'login' ? 'signup' : 'login';
  setStatus('');
  updateAuthModeUI();
});

let loggedIn = false;

async function showLoggedIn(email: string): Promise<void> {
  loggedIn = true;
  loadingEl.style.display = 'flex';
  loginForm.style.display = 'none';
  loggedInView.style.display = 'none';
  accountEmailEl.textContent = email;
  accountPlanEl.textContent = '';
  accountPlanEl.className = '';

  const [watchedRes, accountRes] = await Promise.all([
    sendMessageSafe({ type: 'LIST_WATCHED' }),
    sendMessageSafe({ type: 'GET_ACCOUNT_INFO' }),
  ]);

  if (watchedRes.ok) {
    renderWatchedList(watchedRes.data);
  } else {
    setStatus(watchedRes.error);
  }

  if (accountRes.ok) {
    renderAccountPlan(accountRes.data);
    renderNotifications(accountRes.data.linkedChannels);
  }

  loadingEl.style.display = 'none';
  loggedInView.style.display = 'block';
}

function showLoggedOut(): void {
  loggedIn = false;
  loadingEl.style.display = 'none';
  loginForm.style.display = 'block';
  loggedInView.style.display = 'none';
  authMode = 'login';
  updateAuthModeUI();
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = emailInputEl.value.trim();
  const password = passwordInputEl.value;
  if (!email || !password) {
    setStatus('Enter your email and password.');
    return;
  }

  if (authMode === 'signup') {
    setStatus('Creating account…');
    const res = await sendMessageSafe({ type: 'SIGNUP', email, password });
    if (!res.ok) {
      setStatus(res.error);
      return;
    }
    if (res.data.needsConfirmation) {
      setStatus('Account created. Check your email to confirm it, then log in.');
      authMode = 'login';
      updateAuthModeUI();
      return;
    }
    setStatus('');
    await showLoggedIn(email);
    return;
  }

  setStatus('Logging in…');
  const res = await sendMessageSafe({ type: 'LOGIN', email, password });
  if (res.ok) {
    setStatus('');
    await showLoggedIn(email);
  } else {
    setStatus(res.error);
  }
});

el<HTMLButtonElement>('logout').addEventListener('click', async () => {
  await sendMessageSafe({ type: 'LOGOUT' });
  setStatus('');
  showLoggedOut();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.watchedGymIds || !loggedIn) return;
  sendMessageSafe({ type: 'LIST_WATCHED' }).then((res) => {
    if (res.ok) renderWatchedList(res.data);
  });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !('session' in changes) || changes.session.newValue || !loggedIn) return;
  showLoggedOut();
});

(async () => {
  const res = await sendMessageSafe({ type: 'GET_SESSION' });
  if (res.ok && res.session) {
    await showLoggedIn(res.session.email);
  } else {
    if (!res.ok) setStatus(res.error);
    showLoggedOut();
  }
})();

(async () => {
  const res = await sendMessageSafe({ type: 'CHECK_FOR_UPDATE' });
  if (!res.ok) {
    console.error('[raid-notifier] update check failed:', res.error);
    return;
  }
  const { updateAvailable, breaking, latestVersion, releaseUrl } = res.data;
  if (!updateAvailable) return;

  updateBannerEl.textContent = '';
  const text = document.createElement('span');
  const link = document.createElement('a');
  link.href = releaseUrl;
  link.target = '_blank';
  link.textContent = 'see release';

  if (breaking) {
    text.textContent = `${latestVersion} is out with breaking changes. Some things may not work correctly until you update — `;
    updateBannerEl.className = 'breaking';
  } else {
    text.textContent = `${latestVersion} available — `;
    updateBannerEl.className = 'info';
  }

  updateBannerEl.appendChild(text);
  updateBannerEl.appendChild(link);
})();
