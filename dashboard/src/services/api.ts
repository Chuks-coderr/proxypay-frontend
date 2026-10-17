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
 * A single OpenAPI validation problem tied to a specific location in the
 * document via a JSON Pointer (RFC 6901) path (#710).
 */
export interface ValidationIssue {
  /** JSON Pointer path, e.g. `/paths/~1transactions~1{id}/get/parameters/0` */
  path: string
  /** Human-readable description of the problem */
  message: string
  /** Optional severity so callers can distinguish warnings from errors */
  severity?: 'error' | 'warning'
  /** Optional keyword that triggered the failure (e.g. `required`, `type`) */
  keyword?: string
}

/**
 * Structured result of validating an OpenAPI document (#710).
 * `valid` is true only when there are no error-severity issues.
 */
export interface ValidationResult {
  valid: boolean
  /** Concise one-line summary suitable for a banner */
  summary: string
  /** Individual issues with field-level JSON Pointer context */
  issues: ValidationIssue[]
}

/**
 * Escape a single JSON Pointer reference token per RFC 6901.
 */
function escapePointerToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1')
}

/**
 * Build a JSON Pointer from a sequence of path segments.
 */
export function toJsonPointer(segments: Array<string | number>): string {
  if (segments.length === 0) return ''
  return '/' + segments.map((s) => escapePointerToken(String(s))).join('/')
}

/**
 * Normalize a raw validation error (from a validator or API response) into a
 * structured {@link ValidationIssue} with a JSON Pointer path (#710).
 */
export function normalizeValidationIssue(raw: unknown): ValidationIssue {
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    const segments = Array.isArray(obj.path)
      ? (obj.path as Array<string | number>)
      : typeof obj.instancePath === 'string'
        ? obj.instancePath.split('/').filter((s) => s.length > 0)
        : typeof obj.path === 'string'
          ? obj.path.split('/').filter((s) => s.length > 0)
          : []
    const message =
      typeof obj.message === 'string' && obj.message.length > 0
        ? obj.message
        : 'Validation failed'
    const issue: ValidationIssue = {
      path: toJsonPointer(segments),
      message,
    }
    if (obj.severity === 'warning' || obj.severity === 'error') {
      issue.severity = obj.severity
    }
    if (typeof obj.keyword === 'string') {
      issue.keyword = obj.keyword
    }
    return issue
  }
  return { path: '', message: String(raw ?? 'Validation failed') }
}

/**
 * Build a concise summary line for a set of validation issues (#710).
 */
export function summarizeValidationIssues(issues: ValidationIssue[]): string {
  const errorCount = issues.filter((i) => i.severity !== 'warning').length
  if (issues.length === 0) return 'Document is valid'
  if (errorCount === 0) {
    return `${issues.length} validation warning${issues.length === 1 ? '' : 's'}`
  }
  return `${errorCount} validation error${errorCount === 1 ? '' : 's'}`
}

/**
 * Parse a validation response payload into a structured {@link ValidationResult}.
 * Falls back to a general failure message when the payload cannot be parsed (#710).
 */
export function parseValidationResult(payload: unknown): ValidationResult {
  try {
    if (payload && typeof payload === 'object') {
      const obj = payload as Record<string, unknown>
      const rawIssues = Array.isArray(obj.issues)
        ? obj.issues
        : Array.isArray(obj.errors)
          ? obj.errors
          : null
      if (rawIssues) {
        const issues = rawIssues.map(normalizeValidationIssue)
        const valid =
          typeof obj.valid === 'boolean'
            ? obj.valid
            : !issues.some((i) => i.severity !== 'warning')
        return {
          valid,
          summary:
            typeof obj.summary === 'string' && obj.summary.length > 0
              ? obj.summary
              : summarizeValidationIssues(issues),
          issues,
        }
      }
      if (typeof obj.message === 'string' && obj.message.length > 0) {
        return {
          valid: false,
          summary: obj.message,
          issues: [{ path: '', message: obj.message }],
        }
      }
    }
  } catch {
    // fall through to safe fallback below
  }
  return {
    valid: false,
    summary: 'Validation failed: unable to parse validation details',
    issues: [],
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
