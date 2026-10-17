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

/**
 * JSON Schema validation for request bodies (#714).
 *
 * Client-side validation is opt-in: callers pass the operation's declared
 * schema and receive actionable errors before sending. When a schema cannot
 * be resolved (undefined/null) validation is skipped and the server remains
 * authoritative.
 */
export interface SchemaValidationError {
  /** JSON Pointer to the offending value, e.g. `/user/email` */
  path: string
  /** Human-readable, actionable message */
  message: string
}

export interface SchemaValidationResult {
  valid: boolean
  errors: SchemaValidationError[]
  /** True when no schema was supplied and validation was skipped */
  skipped: boolean
}

type JSONSchema = Record<string, unknown>

const typeOf = (value: unknown): string => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number'
  return typeof value
}

const matchesType = (value: unknown, type: string): boolean => {
  const actual = typeOf(value)
  if (type === 'number') return actual === 'number' || actual === 'integer'
  if (type === 'integer') return actual === 'integer'
  return actual === type
}

const joinPath = (base: string, segment: string | number): string =>
  `${base}/${String(segment).replace(/~/g, '~0').replace(/\//g, '~1')}`

function validateNode(
  value: unknown,
  schema: JSONSchema,
  path: string,
  errors: SchemaValidationError[]
): void {
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!types.some((t) => matchesType(value, String(t)))) {
      errors.push({
        path: path || '/',
        message: `Expected ${types.join(' or ')} but received ${typeOf(value)}`,
      })
      return
    }
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((option) => option === value)) {
    errors.push({
      path: path || '/',
      message: `Value must be one of: ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`,
    })
  }

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      errors.push({ path: path || '/', message: `Must be at least ${schema.minLength} characters` })
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      errors.push({ path: path || '/', message: `Must be at most ${schema.maxLength} characters` })
    }
    if (typeof schema.pattern === 'string') {
      try {
        if (!new RegExp(schema.pattern).test(value)) {
          errors.push({ path: path || '/', message: `Must match pattern ${schema.pattern}` })
        }
      } catch {
        // Ignore malformed patterns; server validation remains authoritative.
      }
    }
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push({ path: path || '/', message: `Must be >= ${schema.minimum}` })
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errors.push({ path: path || '/', message: `Must be <= ${schema.maximum}` })
    }
  }

  if (isPlainObject(value)) {
    const properties = isPlainObject(schema.properties) ? schema.properties : {}
    const required = Array.isArray(schema.required) ? schema.required : []
    for (const key of required) {
      if (!(key in value)) {
        errors.push({ path: joinPath(path, String(key)), message: 'Required field is missing' })
      }
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (key in value && isPlainObject(childSchema)) {
        validateNode(value[key], childSchema, joinPath(path, key), errors)
      }
    }
  }

  if (Array.isArray(value) && isPlainObject(schema.items)) {
    value.forEach((item, index) => {
      validateNode(item, schema.items as JSONSchema, joinPath(path, index), errors)
    })
  }
}

/**
 * Validate a parsed JSON request body against an operation's declared schema.
 * Returns `skipped: true` when no schema is available so callers can fall back
 * to server-side validation.
 */
export function validateJsonBody(
  body: unknown,
  schema?: JSONSchema | null
): SchemaValidationResult {
  if (!schema || !isPlainObject(schema)) {
    return { valid: true, errors: [], skipped: true }
  }
  const errors: SchemaValidationError[] = []
  validateNode(body, schema, '', errors)
  return { valid: errors.length === 0, errors, skipped: false }
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
      recordPerformanceMetric({
        url: config.url ?? '',
        method: (config.method ?? 'get').toUpperCase(),
        durationMs: now() - startedAt,
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
      (error) => {
        recordResponseTime(error?.config)
        return Promise.reject(error)
      }
    )
  }

  setAuthToken(token: string | null) {
    this.authToken = token
    if (token) {
      this.client.defaults.headers.common['Authorization'] = `Bearer ${token}`
    } else {
      delete this.client.defaults.headers.common['Authorization']
    }
  }

  getClient(): AxiosInstance {
    return this.client
  }
}

export const api = new ProxyPayAPI()
export default api
