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
  if (base.startsWith('text/')) {
    return { kind: 'text', mediaType, unsupported: false }
  }
  return {
    kind: 'unsupported',
    mediaType,
    unsupported: true,
    reason: `No editor available for media type "${mediaType}"`,
  }
}

/**
 * Pick the best editor from an operation's declared media types. JSON is
 * preferred when present, otherwise the first supported media type is used.
 * Returns `undefined` when no media types are declared.
 */
export function selectBodyEditorForMediaTypes(
  mediaTypes: string[] | undefined
): BodyEditorSelection | undefined {
  if (!mediaTypes || mediaTypes.length === 0) return undefined
  const selections = mediaTypes.map(selectBodyEditor)
  const json = selections.find((s) => s.kind === 'json')
  if (json) return json
  const supported = selections.find((s) => !s.unsupported)
  if (supported) return supported
  return selections[0]
}

export interface FormFieldEntry {
  key: string
  value: string
  /** Optional file for multipart fields */
  file?: File | Blob
}

/**
 * Construct the `BodyInit` for a given editor selection.
 *
 * Throws when the media type is unsupported so callers can surface the error
 * instead of sending malformed data.
 */
export function buildBodyInit(
  selection: BodyEditorSelection,
  input: {
    json?: string
    text?: string
    fields?: FormFieldEntry[]
    file?: Blob | File | null
  }
): BodyInit {
  switch (selection.kind) {
    case 'json':
      return input.json ?? ''
    case 'text':
      return input.text ?? ''
    case 'form': {
      const formData = new FormData()
      for (const field of input.fields ?? []) {
        if (!field.key) continue
        if (field.file) {
          formData.append(field.key, field.file)
        } else {
          formData.append(field.key, field.value)
        }
      }
      return formData
    }
    case 'urlencoded': {
      const params = new URLSearchParams()
      for (const field of input.fields ?? []) {
        if (!field.key) continue
        params.append(field.key, field.value)
      }
      return params
    }
    case 'binary': {
      if (!input.file) {
        throw new Error(`A file is required for media type "${selection.mediaType}"`)
      }
      return input.file
    }
    case 'unsupported':
    default:
      throw new Error(
        selection.reason ?? `Unsupported media type "${selection.mediaType}"`
      )
  }
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
  if (typeof value === 'object') return 'object'
  return typeof value
}
