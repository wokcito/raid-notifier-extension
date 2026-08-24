export interface Gym {
  scopelyGymId: string;
  name: string | null;
  imageUrl: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface WatchedGymSummary {
  scopelyGymId: string;
  name: string | null;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  email: string;
}

export type NotificationChannel = 'PUSH' | 'TELEGRAM' | 'WHATSAPP';

export interface AccountInfo {
  isPremium: boolean;
  premiumUntil: string | null;
  linkedChannels: NotificationChannel[];
}

export interface TelegramLinkCode {
  deepLink: string;
}

export type PackageMonths = number;

export type PaymentMethod = string;

export type PaymentOrderStatus = 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED';

export interface BillingOrder {
  orderId: number;
  status: PaymentOrderStatus;
  expiresAt: string;
  methodLabel: string;
  payment: { kind: 'crypto'; address: string; expectedAmountSats: string } | null;
}

export interface BillingPackage {
  months: PackageMonths;
  priceUsdCents: number;
  durationMs: number;
}

export interface BillingPaymentMethod {
  method: PaymentMethod;
  label: string;
}

export interface BillingPackagesInfo {
  packages: BillingPackage[];
  methods: BillingPaymentMethod[];
  maxPremiumHorizonMs: number;
}

export interface UpdateStatus {
  updateAvailable: boolean;
  breaking: boolean;
  latestVersion: string;
  releaseUrl: string;
}

export interface RaidNotifierConfig {
  API_BASE_URL: string;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}

export type ExtensionRequest =
  | { type: 'LOGIN'; email: string; password: string }
  | { type: 'SIGNUP'; email: string; password: string }
  | { type: 'LOGOUT' }
  | { type: 'GET_SESSION' }
  | { type: 'LIST_WATCHED' }
  | { type: 'GET_ACCOUNT_INFO' }
  | { type: 'CREATE_TELEGRAM_LINK_CODE' }
  | { type: 'WATCH_GYM'; gym: Gym }
  | { type: 'UNWATCH_GYM'; scopelyGymId: string }
  | { type: 'DISCOVER_GYM'; gym: Gym }
  | { type: 'CHECK_FOR_UPDATE' }
  | { type: 'CREATE_BILLING_ORDER'; packageMonths: PackageMonths; method: PaymentMethod }
  | { type: 'GET_BILLING_ORDER'; orderId: number }
  | { type: 'GET_BILLING_PACKAGES' };

export type RequestType = ExtensionRequest['type'];

export type ApiResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type GetSessionResult =
  | { ok: true; session: Session | null }
  | { ok: false; error: string };

export interface RequestResponseMap {
  LOGIN: ApiResult;
  SIGNUP: ApiResult<{ needsConfirmation: boolean }>;
  LOGOUT: ApiResult;
  GET_SESSION: GetSessionResult;
  LIST_WATCHED: ApiResult<WatchedGymSummary[]>;
  GET_ACCOUNT_INFO: ApiResult<AccountInfo>;
  CREATE_TELEGRAM_LINK_CODE: ApiResult<TelegramLinkCode>;
  WATCH_GYM: ApiResult<unknown>;
  UNWATCH_GYM: ApiResult<unknown>;
  DISCOVER_GYM: ApiResult<undefined>;
  CHECK_FOR_UPDATE: ApiResult<UpdateStatus>;
  CREATE_BILLING_ORDER: ApiResult<BillingOrder>;
  GET_BILLING_ORDER: ApiResult<BillingOrder>;
  GET_BILLING_PACKAGES: ApiResult<BillingPackagesInfo>;
}
