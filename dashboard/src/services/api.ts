import axios, { AxiosInstance } from 'axios'
import { recordPerformanceMetric } from './performance'

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
 * OpenAPI parameter serialization styles (#713).
 * See https://swagger.io/docs/specification/serialization/
 */
export type ParameterStyle =
  | 'form'
  | 'simple'
  | 'spaceDelimited'
  | 'pipeDelimited'
  | 'deepObject'

export type ParameterLocation = 'query' | 'path' | 'header' | 'cookie'

export interface ParameterSerializationOptions {
  style?: ParameterStyle
  explode?: boolean
  location?: ParameterLocation
}

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

    const token = localStorage.getItem('auth_token')
    if (token) {
      this.client.defaults.headers.common['Authorization'] = `Bearer ${token}`
    }

    const requestStartedAt = new WeakMap<object, number>()
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
    const recordResponseTime = (config?: object & { url?: string; method?: string }) => {
      if (!config) return
      const startedAt = requestStartedAt.get(config)
      if (startedAt === undefined) return
      requestStartedAt.delete(config)
      recordPerformanceMetric('api-response', now() - startedAt, {
        endpoint: config.url || 'unknown',
        method: (config.method || 'get').toUpperCase(),
      })
    }

    this.client.interceptors.request.use((config) => {
      requestStartedAt.set(config, now())
      return config
    })
    this.client.interceptors.response.use(
      (response) => {
        recordResponseTime(response.config)
        return response
      },
      (error: unknown) => {
        if (error && typeof error === 'object' && 'config' in error) {
          recordResponseTime((error as { config?: object }).config)
        }
        return Promise.reject(error)
      }
    )
  }

  private unwrap<T>(payload: ApiPayload<T>): T {
    if (payload && typeof payload === 'object' && 'data' in payload) {
      return payload.data
    }
    return payload as T
  }

  async getTransactions(filters: TransactionFilters): Promise<{
    data: Transaction[]
    total: number
  }> {
    const { data } = await this.client.get('/transactions', { params: filters })
    return data
  }

  async getTransactionDetail(id: string): Promise<Transaction> {
    const { data } = await this.client.get(`/transactions/${encodeURIComponent(id)}`)
    return this.unwrap<Transaction>(data)
  }

  async getStatusHistory(id: string): Promise<StatusTransition[]> {
    const { data } = await this.client.get(
      `/transactions/${encodeURIComponent(id)}/status-history`
    )
    return this.unwrap<StatusTransition[]>(data) || []
  }

  async getDuplicateTransactions(
    filters?: TransactionFilters
  ): Promise<DuplicateTransactionGroup[]> {
    const { data } = await this.client.get('/transactions/duplicates', {
      params: filters,
    })
    return this.unwrap<DuplicateTransactionGroup[]>(data) || []
  }

  getDuplicateCandidates(
    filters?: TransactionFilters
  ): Promise<DuplicateTransactionGroup[]> {
    return this.getDuplicateTransactions(filters)
  }

  async markTransactionsAsDuplicates(
    request: DuplicateMarkRequest
  ): Promise<DuplicateTransactionGroup | DuplicateTransactionGroup[]> {
    const { data } = await this.client.post('/transactions/duplicates/mark', request)
    return this.unwrap<DuplicateTransactionGroup | DuplicateTransactionGroup[]>(data)
  }

  markDuplicateTransactions(
    request: DuplicateMarkRequest
  ): Promise<DuplicateTransactionGroup | DuplicateTransactionGroup[]> {
    return this.markTransactionsAsDuplicates(request)
  }

  async mergeTransactions(
    canonicalId: string,
    duplicateIds: string[],
    metadata?: Pick<MergeTransactionsRequest, 'actor' | 'reason'>
  ): Promise<Transaction> {
    const { data } = await this.client.post('/transactions/merge', {
      canonicalId,
      duplicateIds,
      ...metadata,
    })
    return this.unwrap<Transaction>(data)
  }

  mergeDuplicateTransactions(
    canonicalId: string,
    duplicateIds: string[]
  ): Promise<Transaction> {
    return this.mergeTransactions(canonicalId, duplicateIds)
  }

  async getExportSchedules(): Promise<ExportSchedule[]> {
    const { data } = await this.client.get('/transactions/exports/schedules')
    return this.unwrap<ExportSchedule[]>(data) || []
  }

  async createExportSchedule(
    schedule: CreateExportSchedule
  ): Promise<ExportSchedule> {
    const { data } = await this.client.post(
      '/transactions/exports/schedules',
      schedule
    )
    return this.unwrap<ExportSchedule>(data)
  }

  async updateExportSchedule(
    id: string,
    schedule: Partial<CreateExportSchedule>
  ): Promise<ExportSchedule> {
    const { data } = await this.cl

/* … truncated 1863 chars — edit only what you need near the top … */
