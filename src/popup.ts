import qrcode from 'qrcode-generator';
import type {
  AccountInfo,
  BillingOrder,
  BillingPackage,
  BillingPaymentMethod,
  ExtensionRequest,
  NotificationChannel,
  PackageMonths,
  RequestResponseMap,
  WatchedGymSummary,
} from './types';

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element #${id} in popup.html`);
  return found as T;
}

const loginForm = el<HTMLDivElement>('login-form');
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
const premiumMethodSelectEl = el<HTMLSelectElement>('premium-method-select');
const premiumPackagesEl = el<HTMLDivElement>('premium-packages');
const premiumCapHintEl = el<HTMLDivElement>('premium-cap-hint');
const premiumOrderEl = el<HTMLDivElement>('premium-order');
const premiumOrderMethodEl = el<HTMLDivElement>('premium-order-method');
const premiumOrderStatusEl = el<HTMLDivElement>('premium-order-status');
const premiumOrderAmountEl = el<HTMLDivElement>('premium-order-amount');
const premiumOrderActionsEl = el<HTMLDivElement>('premium-order-actions');
const premiumCopyBtnEl = el<HTMLButtonElement>('premium-copy-btn');
const premiumQrBtnEl = el<HTMLButtonElement>('premium-qr-btn');
const premiumQrEl = el<HTMLDivElement>('premium-qr');
const premiumExpiryEl = el<HTMLDivElement>('premium-expiry');
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

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

function renderAccountPlan(info: AccountInfo): void {
  if (info.isPremium && info.premiumUntil) {
    accountPlanEl.textContent = `Premium · until ${formatDate(info.premiumUntil)}`;
  } else {
    accountPlanEl.textContent = info.isPremium ? 'Premium' : 'Free';
  }
  accountPlanEl.className = info.isPremium ? 'premium' : 'free';
  lastPremiumUntil = info.premiumUntil;
  updatePackageAvailability();
}

let billingPackages: BillingPackage[] = [];
let maxPremiumHorizonMs = 0;
let lastPremiumUntil: string | null = null;

function getPackageButtons(): HTMLButtonElement[] {
  return Array.from(premiumPackagesEl.querySelectorAll<HTMLButtonElement>('.package-btn'));
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function renderMethodOptions(methods: BillingPaymentMethod[]): void {
  const previousValue = premiumMethodSelectEl.value;
  premiumMethodSelectEl.innerHTML = '';
  for (const m of methods) {
    const option = document.createElement('option');
    option.value = m.method;
    option.textContent = m.label;
    premiumMethodSelectEl.appendChild(option);
  }
  if (methods.some((m) => m.method === previousValue)) {
    premiumMethodSelectEl.value = previousValue;
  }
}

function renderPackageButtons(packages: BillingPackage[]): void {
  premiumPackagesEl.innerHTML = '';
  for (const pkg of packages) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'package-btn';
    btn.dataset.months = String(pkg.months);
    btn.textContent = `${pkg.months === 1 ? '1 month' : `${pkg.months} months`} · ${formatUsd(pkg.priceUsdCents)}`;
    btn.addEventListener('click', () => handlePackageClick(pkg.months));
    premiumPackagesEl.appendChild(btn);
  }
}

async function loadBillingPackages(): Promise<void> {
  const res = await sendMessageSafe({ type: 'GET_BILLING_PACKAGES' });
  if (!res.ok) return;
  billingPackages = res.data.packages;
  maxPremiumHorizonMs = res.data.maxPremiumHorizonMs;
  renderMethodOptions(res.data.methods);
  renderPackageButtons(billingPackages);
  updatePackageAvailability();
}

function updatePackageAvailability(): void {
  if (billingPackages.length === 0) return;
  const now = Date.now();
  const until = lastPremiumUntil ? new Date(lastPremiumUntil).getTime() : 0;
  const base = until > now ? until : now;
  let anyDisabled = false;

  for (const btn of getPackageButtons()) {
    const months = Number(btn.dataset.months);
    const pkg = billingPackages.find((p) => p.months === months);
    if (!pkg) continue;
    const exceeds = base + pkg.durationMs - now > maxPremiumHorizonMs;
    btn.disabled = exceeds;
    btn.title = exceeds ? "This would push your premium past next year's date." : '';
    if (exceeds) anyDisabled = true;
  }

  premiumCapHintEl.style.display = anyDisabled ? 'block' : 'none';
  premiumCapHintEl.textContent = anyDisabled
    ? "Some packages are disabled: they'd push your premium more than a year out."
    : '';
}

function satsToBchString(sats: string): string {
  const padded = sats.padStart(9, '0');
  const whole = padded.slice(0, -8) || '0';
  const frac = padded.slice(-8).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

const BILLING_POLL_INTERVAL_MS = 10_000;
let billingPollTimer: ReturnType<typeof setInterval> | null = null;

function stopBillingPoll(): void {
  if (billingPollTimer) {
    clearInterval(billingPollTimer);
    billingPollTimer = null;
  }
}

function setPackageButtonsDisabled(disabled: boolean): void {
  for (const btn of getPackageButtons()) btn.disabled = disabled;
}

let currentPaymentUri: string | null = null;
let currentPaymentAddress: string | null = null;

function renderBillingOrder(order: BillingOrder): void {
  premiumOrderEl.style.display = 'block';
  premiumOrderMethodEl.textContent = `Paying with ${order.methodLabel}`;

  if (!order.payment) {
    premiumOrderStatusEl.textContent = `Order status: ${order.status}`;
    premiumOrderAmountEl.textContent = '';
    premiumOrderActionsEl.style.display = 'none';
    premiumExpiryEl.style.display = 'none';
    currentPaymentUri = null;
    currentPaymentAddress = null;
    return;
  }

  const bchAmount = satsToBchString(order.payment.expectedAmountSats);
  const uri = `${order.payment.address}?amount=${bchAmount}`;
  currentPaymentUri = uri;
  currentPaymentAddress = order.payment.address;
  premiumOrderAmountEl.textContent = `${order.payment.address}\n${bchAmount} BCH`;
  premiumOrderActionsEl.style.display = 'flex';

  if (premiumQrEl.dataset.renderedFor !== uri) {
    premiumQrEl.style.display = 'none';
    premiumQrEl.dataset.renderedFor = '';
    premiumQrBtnEl.textContent = 'Show QR code';
  }

  if (order.status === 'PENDING') {
    premiumOrderStatusEl.textContent = '⏳ Waiting for payment…';
    premiumExpiryEl.style.display = 'block';
    premiumExpiryEl.textContent = `Quote expires at ${formatDateTime(order.expiresAt)}. Send the exact amount shown above.`;
  } else if (order.status === 'PAID') {
    premiumOrderStatusEl.textContent = '✅ Payment received! Premium is active.';
    premiumExpiryEl.style.display = 'none';
  } else if (order.status === 'EXPIRED') {
    premiumOrderStatusEl.textContent = '⌛ This quote expired without payment. Start a new one below.';
    premiumExpiryEl.style.display = 'none';
  } else {
    premiumOrderStatusEl.textContent = order.status;
    premiumExpiryEl.style.display = 'none';
  }
}

const PENDING_ORDER_STORAGE_KEY = 'pendingBillingOrderId';

function rememberPendingOrder(orderId: number): Promise<void> {
  return chrome.storage.local.set({ [PENDING_ORDER_STORAGE_KEY]: orderId });
}

function forgetPendingOrder(): Promise<void> {
  return chrome.storage.local.remove(PENDING_ORDER_STORAGE_KEY);
}

async function resumePendingOrder(): Promise<void> {
  const stored = await chrome.storage.local.get(PENDING_ORDER_STORAGE_KEY);
  const orderId = stored[PENDING_ORDER_STORAGE_KEY];
  if (typeof orderId !== 'number') return;

  const res = await sendMessageSafe({ type: 'GET_BILLING_ORDER', orderId });
  if (!res.ok) {
    await forgetPendingOrder();
    return;
  }

  renderBillingOrder(res.data);
  if (res.data.status === 'PENDING') {
    setPackageButtonsDisabled(true);
    pollBillingOrder(orderId);
  } else {
    await forgetPendingOrder();
  }
}

function pollBillingOrder(orderId: number): void {
  stopBillingPoll();
  billingPollTimer = setInterval(async () => {
    const res = await sendMessageSafe({ type: 'GET_BILLING_ORDER', orderId });
    if (!res.ok) return;
    renderBillingOrder(res.data);
    if (res.data.status !== 'PENDING') {
      stopBillingPoll();
      updatePackageAvailability();
      await forgetPendingOrder();
      if (res.data.status === 'PAID') {
        const accountRes = await sendMessageSafe({ type: 'GET_ACCOUNT_INFO' });
        if (accountRes.ok) renderAccountPlan(accountRes.data);
      }
    }
  }, BILLING_POLL_INTERVAL_MS);
}

async function handlePackageClick(months: PackageMonths): Promise<void> {
  setPackageButtonsDisabled(true);
  setStatus('');
  const res = await sendMessageSafe({
    type: 'CREATE_BILLING_ORDER',
    packageMonths: months,
    method: premiumMethodSelectEl.value,
  });
  if (!res.ok) {
    setStatus(res.error);
    updatePackageAvailability();
    return;
  }
  renderBillingOrder(res.data);
  await rememberPendingOrder(res.data.orderId);
  pollBillingOrder(res.data.orderId);
}

premiumCopyBtnEl.addEventListener('click', async () => {
  if (!currentPaymentAddress) return;
  try {
    await navigator.clipboard.writeText(currentPaymentAddress);
    const original = premiumCopyBtnEl.textContent;
    premiumCopyBtnEl.textContent = 'Copied!';
    setTimeout(() => {
      premiumCopyBtnEl.textContent = original;
    }, 1500);
  } catch (e) {
    console.error('[raid-notifier] could not copy the BCH address:', e);
  }
});

premiumQrBtnEl.addEventListener('click', () => {
  const uri = currentPaymentUri;
  if (!uri) return;
  const showing = premiumQrEl.style.display !== 'none';
  if (showing) {
    premiumQrEl.style.display = 'none';
    premiumQrBtnEl.textContent = 'Show QR code';
    return;
  }
  if (premiumQrEl.dataset.renderedFor !== uri) {
    const qr = qrcode(0, 'M');
    qr.addData(uri);
    qr.make();
    premiumQrEl.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    premiumQrEl.dataset.renderedFor = uri;
  }
  premiumQrEl.style.display = 'block';
  premiumQrBtnEl.textContent = 'Hide QR code';
});

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
  loginForm.style.display = 'none';
  loggedInView.style.display = 'block';
  accountEmailEl.textContent = email;
  accountPlanEl.textContent = '';
  accountPlanEl.className = '';

  const [watchedRes, accountRes] = await Promise.all([
    sendMessageSafe({ type: 'LIST_WATCHED' }),
    sendMessageSafe({ type: 'GET_ACCOUNT_INFO' }),
    loadBillingPackages(),
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

  await resumePendingOrder();
}

function showLoggedOut(): void {
  loggedIn = false;
  loginForm.style.display = 'block';
  loggedInView.style.display = 'none';
  authMode = 'login';
  updateAuthModeUI();
  stopBillingPoll();
  premiumOrderEl.style.display = 'none';
  setPackageButtonsDisabled(false);
}

loginBtnEl.addEventListener('click', async () => {
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
  await forgetPendingOrder();
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
