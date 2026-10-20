import axios, { AxiosInstance, AxiosError } from 'axios'
import { recordPerformanceMetric } from './performance'
import { useInterceptorLogStore } from '../stores/interceptorLogStore'
import { useApiConfigStore } from '../stores/apiConfigStore'

export type TransactionStatus =
  | 'pending'
  | 'settled'
  | 'failed'
  | 'processing'
  | 'cancelled'
  | 'refunded'
  | 'duplicate'
  | (string & {})

export interface StatusTransition {
  id?: string
  fromStatus?: TransactionStatus | null
  toStatus: TransactionStatus
  timestamp: string
  actor?: string
  reason?: string
  details?: string
}

export interface AuditEvent {
  timestamp: string
  event: string
  details: string
  actor: string
  fromStatus?: TransactionStatus | null
  toStatus?: TransactionStatus
  reason?: string
}

export interface Transaction {
  id: string
  reference: string
  stellarHash: string
  mobileMoneyReference: string
  amount: number
  fee: number
  feeBreakdown: {
    platformFee: number
    networkFee: number
    providerFee: number
  }
  status: TransactionStatus
  provider: 'vodafone' | 'mtn' | 'airtel'
  timestamp: string
  settledAt?: string
  failureReason?: string
  auditTrail: AuditEvent[]
  statusHistory?: StatusTransition[]
  statusChanges?: StatusTransition[]
  duplicateOf?: string
  isDuplicate?: boolean
  mergedIntoId?: string
}

export interface TransactionFilters {
  dateFrom?: string
  dateTo?: string
  status?: string
  /** Single provider (legacy, kept for API compat) */
  provider?: string
  /** Multi-select providers for UI filtering (#495) */
  providers?: Array<'vodafone' | 'mtn' | 'airtel'>
  limit?: number
  offset?: number
}

export type DuplicateMatchReason =
  | 'stellarHash'
  | 'mobileMoneyReference'
  | 'reference'
  | 'transactionFingerprint'
  | 'manual'

export interface DuplicateTransactionGroup {
  id: string
  transactionIds: string[]
  canonicalId: string
  transactions: Transaction[]
  reason: DuplicateMatchReason
  confidence: number
  markedAsDuplicate?: boolean
}

export interface DuplicateMarkRequest {
  transactionIds: string[]
  duplicateOfId: string
  reason?: string
}

export interface MergeTransactionsRequest {
  canonicalId: string
  duplicateIds: string[]
  actor?: string
  reason?: string
}

export type ExportFrequency = 'daily' | 'weekly' | 'monthly'
export type ExportDeliveryType = 'email' | 'webhook'
export type ExportFormat = 'csv'

export interface ExportDelivery {
  type: ExportDeliveryType
  email?: string
  webhookUrl?: string
}

export interface ExportSchedule {
  id: string
  name: string
  frequency: ExportFrequency
  time: string
  timezone: string
  dayOfWeek?: number
  dayOfMonth?: number
  format: ExportFormat
  includeAuditTrail: boolean
  filters?: TransactionFilters
  delivery: ExportDelivery
  notifyOnCompletion: boolean
  active: boolean
  nextRunAt?: string
  lastRunAt?: string
  createdAt?: string
  updatedAt?: string
}

export type CreateExportSchedule = Omit<ExportSchedule, 'id' | 'nextRunAt' | 'lastRunAt' | 'createdAt' | 'updatedAt'> & {
  id?: string
  nextRunAt?: string
  lastRunAt?: string
}

export interface ExportCompletionNotification {
  id?: string
  scheduleId: string
  message: string
  completedAt: string
}

export interface NotificationSettings {
  eventType: string
  emailEnabled: boolean
  webhookEnabled: boolean
}

export interface NotificationConfig {
  settings: NotificationSettings[]
}

export interface ScheduledExport {
  id: string
  scheduledFor: string
  status: 'scheduled' | 'processing' | 'ready' | 'failed'
}

export interface DashboardNotification {
  id: string
  title: string
  message: string
  createdAt: string
  read: boolean
  actionUrl?: string
}

/**
 * Tracks the latest in-flight request per key so that stale (superseded)
 * responses can be discarded instead of overwriting newer results (#720).
 */
export class LatestRequestTracker {
  private latest = new Map<string, number>()
  private counter = 0

  /** Begin a new request for `key`; returns a token identifying this request. */
  begin(key: string): number {
    const token = ++this.counter
    this.latest.set(key, token)
    return token
  }

  /** True when `token` is still the most recent request for `key`. */
  isLatest(key: string, token: number): boolean {
    return this.latest.get(key) === token
  }

  /** Forget the tracked request for `key` (e.g. on unmount). */
  clear(key: string): void {
    this.latest.delete(key)
  }
}

class ProxyPayAPI {
  private client: AxiosInstance
  private authToken: string | null = null

  constructor(baseURL = '/api') {
    this.client = axios.create({
      baseURL,
      withCredentials: true,
      headers: {
        'Content-Type': 'application/json',
      },
    })

type Primitive = string | number | boolean

const encode = (value: Primitive): string => encodeURIComponent(String(value))

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const defaultStyle = (location: ParameterLocation): ParameterStyle =>
  location === 'path' || location === 'header' ? 'simple' : 'form'

const defaultExplode = (style: ParameterStyle): boolean => style === 'form'

/**
 * Serialize a single parameter value according to its OpenAPI style/explode
 * metadata. Returns the encoded query-string fragment (without a leading `?`).
 * For path/header/cookie locations the raw (unencoded) value is returned so
 * callers can encode it in the appropriate context.
 */
export function serializeParameter(
  name: string,
  value: unknown,
  options: ParameterSerializationOptions = {}
): string {
  const location = options.location ?? 'query'
  const style = options.style ?? defaultStyle(location)
  const explode = options.explode ?? defaultExplode(style)
  const encodedName = encodeURIComponent(name)

  if (value === undefined || value === null) return ''

  if (Array.isArray(value)) {
    const items = value.map((item) => encode(item as Primitive))
    if (style === 'spaceDelimited') {
      return `${encodedName}=${items.join('%20')}`
    }
    if (style === 'pipeDelimited') {
      return `${encodedName}=${items.join('|')}`
    }
    if (style === 'simple') {
      return items.join(',')
    }
    // form (default for query/cookie)
    if (explode) {
      return items.map((item) => `${encodedName}=${item}`).join('&')
    }
    return `${encodedName}=${items.join(',')}`
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value).filter(
      ([, v]) => v !== undefined && v !== null
    )
    if (style === 'deepObject') {
      return entries
        .map(([k, v]) => `${encodedName}%5B${encodeURIComponent(k)}%5D=${encode(v as Primitive)}`)
        .join('&')
    }
    if (style === 'simple') {
      return entries.map(([k, v]) => `${encodeURIComponent(k)},${encode(v as Primitive)}`).join(',')
    }
    // form
    if (explode) {
      return entries
        .map(([k, v]) => `${encodeURIComponent(k)}=${encode(v as Primitive)}`)
        .join('&')
    }
    const flat = entries
      .map(([k, v]) => `${encodeURIComponent(k)},${encode(v as Primitive)}`)
      .join(',')
    return `${encodedName}=${flat}`
  }

  return `${encodedName}=${encode(value as Primitive)}`
}

/**
 * Serialize a set of parameters into a query string using each parameter's
 * style/explode metadata. Returns a string without a leading `?`.
 */
export function serializeQueryParameters(
  params: Record<string, unknown>,
  metadata: Record<string, ParameterSerializationOptions> = {}
): string {
  const parts: string[] = []
  for (const [name, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    const fragment = serializeParameter(name, value, {
      location: 'query',
      ...metadata[name],
    })
    if (fragment) parts.push(fragment)
  }
  return parts.join('&')
}

/**
 * Request body media-type editors (#715).
 *
 * Operations may declare one or more request body media types. The workbench
 * picks a matching editor and constructs the appropriate `BodyInit`:
 *  - `application/json` (and `+json`) → JSON editor → string body
 *  - `multipart/form-data` → key/value editor → `FormData`
 *  - `application/x-www-form-urlencoded` → key/value editor → `URLSearchParams`
 *  - binary (`application/octet-stream`, `image/*`, etc.) → file editor → `Blob`
 *  - `text/*` → plain text editor → string body
 *
 * Unsupported media types are surfaced explicitly so callers never silently
 * send malformed data.
 */
export type BodyEditorKind = 'json' | 'form' | 'urlencoded' | 'binary' | 'text' | 'unsupported'

export interface BodyEditorSelection {
  kind: BodyEditorKind
  /** The media type the editor was selected for */
  mediaType: string
  /** True when the media type is not supported by any editor */
  unsupported: boolean
  /** Human-readable reason when unsupported */
  reason?: string
}

const isJsonMediaType = (mediaType: string): boolean => {
  const base = mediaType.split(';')[0].trim().toLowerCase()
  return base === 'application/json' || base.endsWith('+json')
}

const isBinaryMediaType = (mediaType: string): boolean => {
  const base = mediaType.split(';')[0].trim().toLowerCase()
  if (base === 'application/octet-stream') return true
  if (base.startsWith('image/')) return true
  if (base.startsWith('audio/')) return true
  if (base.startsWith('video/')) return true
  if (base === 'application/pdf') return true
  if (base === 'application/zip') return true
  return false
}

/**
 * Choose the editor kind for a single declared media type.
 */
export function selectBodyEditor(mediaType: string): BodyEditorSelection {
  const base = mediaType.split(';')[0].trim().toLowerCase()
  if (isJsonMediaType(base)) {
    return { kind: 'json', mediaType, unsupported: false }
  }
  if (base === 'multipart/form-data') {
    return { kind: 'form', mediaType, unsupported: false }
  }
  if (base === 'application/x-www-form-urlencoded') {
    return { kind: 'urlencoded', mediaType, unsupported: false }
  }
  if (isBinaryMediaType(base)) {
    return { kind: 'binary', mediaType, unsupported: false }
  }

  async updateExportSchedule(
    id: string,
    schedule: Partial<CreateExportSchedule>
  ): Promise<ExportSchedule> {
    const { data } = await this.client.put(
      `/transactions/exports/schedules/${encodeURIComponent(id)}`,
      schedule
    )
    return this.unwrap<ExportSchedule>(data)
  }
  return {
    kind: 'unsupported',
    mediaType,
    unsupported: true,
    reason: `No editor available for media type "${mediaType}"`,
  }
}

  async getExportNotifications(): Promise<ExportCompletionNotification[]> {
    const { data } = await this.client.get('/transactions/exports/notifications')
    return this.unwrap<ExportCompletionNotification[]>(data) || []
  }

  async getNotificationConfig(): Promise<NotificationConfig> {
    const { data } = await this.client.get('/transactions/exports/notifications/config')
    return this.unwrap<NotificationConfig>(data)
  }

  async updateNotificationConfig(
    config: NotificationConfig
  ): Promise<NotificationConfig> {
    const { data } = await this.client.put(
      '/transactions/exports/notifications/config',
      config
    )
    return this.unwrap<NotificationConfig>(data)
  }
}

  async getScheduledExports(): Promise<ScheduledExport[]> {
    const { data } = await this.client.get('/transactions/exports/scheduled')
    return this.unwrap<ScheduledExport[]>(data) || []
  }

  async getDashboardNotifications(): Promise<DashboardNotification[]> {
    const { data } = await this.client.get('/notifications')
    return this.unwrap<DashboardNotification[]>(data) || []
  }

  async markNotificationRead(id: string): Promise<void> {
    await this.client.post(`/notifications/${encodeURIComponent(id)}/read`)
  }
}

export interface ApiPayload<T> {
  data: T
}

export const api = new ProxyPayAPI()
export default api
