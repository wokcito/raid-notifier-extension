import type { ExtensionRequest, NotificationChannel, RequestResponseMap, WatchedGymSummary } from './types';

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element #${id} in popup.html`);
  return found as T;
}

const loginForm = el<HTMLDivElement>('login-form');
const loggedInView = el<HTMLDivElement>('logged-in');
const accountEl = el<HTMLDivElement>('account');
const watchedListEl = el<HTMLUListElement>('watched-list');
const watchedEmptyEl = el<HTMLDivElement>('watched-empty');
const statusEl = el<HTMLDivElement>('status');
const telegramLinkedEl = el<HTMLSpanElement>('telegram-linked');
const telegramLinkBtnEl = el<HTMLAnchorElement>('telegram-link-btn');
const telegramHintEl = el<HTMLDivElement>('telegram-hint');
const loginBtnEl = el<HTMLButtonElement>('login');
const versionEl = el<HTMLSpanElement>('version');
versionEl.textContent = `v${chrome.runtime.getManifest().version}`;
const authToggleTextEl = el<HTMLSpanElement>('auth-toggle-text');
const toggleModeEl = el<HTMLAnchorElement>('toggle-mode');

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

async function renderNotifications(linkedChannels: NotificationChannel[]): Promise<void> {
  const telegramLinked = linkedChannels.includes('TELEGRAM');
  telegramLinkedEl.style.display = telegramLinked ? 'inline' : 'none';
  telegramLinkBtnEl.style.display = telegramLinked ? 'none' : 'inline-block';
  telegramHintEl.style.display = telegramLinked ? 'none' : 'block';

  if (telegramLinked) return;

  telegramLinkBtnEl.textContent = 'Link Telegram';
  telegramLinkBtnEl.setAttribute('href', '#');
  const res = await sendMessageSafe({ type: 'CREATE_TELEGRAM_LINK_CODE' });
  if (res.ok && res.data?.deepLink) {
    telegramLinkBtnEl.setAttribute('href', res.data.deepLink);
  } else {
    telegramLinkBtnEl.textContent = "Couldn't generate the link (see console)";
    console.error('[raid-notifier]', !res.ok ? res.error : '(no deepLink)');
  }
}

telegramLinkBtnEl.addEventListener('click', (e) => {
  if (telegramLinkBtnEl.getAttribute('href') === '#') e.preventDefault();
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
  loginForm.style.display = 'none';
  loggedInView.style.display = 'block';
  accountEl.textContent = email;

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
    await renderNotifications(accountRes.data.linkedChannels);
  }
}

function showLoggedOut(): void {
  loggedIn = false;
  loginForm.style.display = 'block';
  loggedInView.style.display = 'none';
  authMode = 'login';
  updateAuthModeUI();
}

loginBtnEl.addEventListener('click', async () => {
  const email = el<HTMLInputElement>('email').value.trim();
  const password = el<HTMLInputElement>('password').value;
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

(async () => {
  const res = await sendMessageSafe({ type: 'GET_SESSION' });
  if (res.ok && res.session) {
    await showLoggedIn(res.session.email);
  } else {
    if (!res.ok) setStatus(res.error);
    showLoggedOut();
  }
})();
