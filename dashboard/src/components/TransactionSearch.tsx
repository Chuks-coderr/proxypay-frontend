import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Search, X, Clock } from 'lucide-react'
import { Transaction } from '../services/api'
import '../styles/TransactionSearch.css'

const SEARCH_HISTORY_KEY = 'proxypay_search_history'
const MAX_HISTORY_ITEMS = 8

// ── Utility: exported so TransactionsTable can use it ────────────────────────

/**
 * Returns true if the transaction matches the given search query.
 * Matches against id, reference, and provider (case-insensitive).
 */
export function matchesSearch(tx: Transaction, query: string): boolean {
  if (!query.trim()) return true
  const q = query.toLowerCase().trim()
  return (
    tx.id.toLowerCase().includes(q) ||
    tx.reference.toLowerCase().includes(q) ||
    tx.provider.toLowerCase().includes(q)
  )
}

/**
 * Wraps any portion of `text` that matches `query` in a <mark> element.
 */
export function HighlightMatch({
  text,
  query,
}: {
  text: string
  query: string
}): React.ReactElement {
  if (!query.trim()) return <>{text}</>

  const q = query.trim()
  const idx = text.toLowerCase().indexOf(q.toLowerCase())
  if (idx === -1) return <>{text}</>

  return (
    <>
      {text.slice(0, idx)}
      <mark className="search-highlight">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  )
}

// ── Search history helpers ────────────────────────────────────────────────────

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(SEARCH_HISTORY_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

function saveHistory(history: string[]): void {
  try {
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history))
  } catch {
    // localStorage may be unavailable (e.g. private mode quota)
  }
}

function addToHistory(query: string, existing: string[]): string[] {
  const q = query.trim()
  if (!q) return existing
  const deduped = [q, ...existing.filter((h) => h !== q)].slice(
    0,
    MAX_HISTORY_ITEMS
  )
  saveHistory(deduped)
  return deduped
}

// ── Portal page route index ───────────────────────────────────────────────────

export type PageCategory = 'Guides' | 'Dashboards' | 'Settings'

export interface PortalPage {
  title: string
  description: string
  path: string
  category: PageCategory
  keywords?: string[]
}

/**
 * Route index built from the portal's page metadata. Used by the
 * portal-wide search dialog to surface guides, dashboards, and settings.
 */
export const PORTAL_PAGES: PortalPage[] = [
  {
    title: 'Getting Started',
    description: 'Install the SDK and send your first request.',
    path: '/docs/getting-started',
    category: 'Guides',
    keywords: ['install', 'quickstart', 'setup'],
  },
  {
    title: 'Authentication',
    description: 'API keys, signing, and request authentication.',
    path: '/docs/authentication',
    category: 'Guides',
    keywords: ['api key', 'token', 'auth'],
  },
  {
    title: 'Endpoint Reference',
    description: 'Browse every available API endpoint.',
    path: '/docs/reference',
    category: 'Guides',
    keywords: ['api', 'endpoints', 'reference'],
  },
  {
    title: 'Transactions Dashboard',
    description: 'View and filter recent transactions.',
    path: '/dashboard/transactions',
    category: 'Dashboards',
    keywords: ['payments', 'history', 'activity'],
  },
  {
    title: 'Analytics Overview',
    description: 'Volume, success rate, and provider breakdown.',
    path: '/dashboard/analytics',
    category: 'Dashboards',
    keywords: ['metrics', 'charts', 'stats'],
  },
  {
    title: 'Account Settings',
    description: 'Manage profile, team, and billing details.',
    path: '/settings/account',
    category: 'Settings',
    keywords: ['profile', 'team', 'billing'],
  },
  {
    title: 'API Keys',
    description: 'Create and revoke API keys.',
    path: '/settings/api-keys',
    category: 'Settings',
    keywords: ['keys', 'secrets', 'tokens'],
  },
]

/**
 * Returns portal pages matching the query against title, description,
 * and keywords (case-insensitive). Empty query returns all pages.
 */
export function searchPortalPages(query: string): PortalPage[] {
  const q = query.toLowerCase().trim()
  if (!q) return PORTAL_PAGES
  return PORTAL_PAGES.filter((page) => {
    const haystack = [page.title, page.description, ...(page.keywords ?? [])]
      .join(' ')
      .toLowerCase()
    return haystack.includes(q)
  })
}

/**
 * Groups portal pages by category, preserving category order.
 */
export function groupPortalPages(
  pages: PortalPage[]
): Array<{ category: PageCategory; pages: PortalPage[] }> {
  const order: PageCategory[] = ['Guides', 'Dashboards', 'Settings']
  return order
    .map((category) => ({
      category,
      pages: pages.filter((p) => p.category === category),
    }))
    .filter((group) => group.pages.length > 0)
}

// ── Component ─────────────────────────────────────────────────────────────────

interface TransactionSearchProps {
  /** Called with the debounced query string whenever it changes */
  onSearch: (query: string) => void
  /** Number of results currently visible after filtering */
  resultCount: number
  /** Total unfiltered transaction count */
  totalCount: number
}

export const TransactionSearch: React.FC<TransactionSearchProps> = ({
  onSearch,
  resultCount,
  totalCount,
}) => {
  const [inputValue, setInputValue] = useState('')
  const [history, setHistory] = useState<string[]>(loadHistory)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Debounce: fire onSearch 300 ms after the last keystroke
  useEffect(() => {
    const timer = setTimeout(() => {
      onSearch(inputValue)
    }, 300)
    return () => clearTimeout(timer)
  }, [inputValue, onSearch])

  // Close suggestion list on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value)
    setShowSuggestions(e.target.value === '' && history.length > 0)
  }

  const handleFocus = () => {
    if (inputValue === '' && history.length > 0) {
      setShowSuggestions(true)
    }
  }

  const handleClear = useCallback(() => {
    setInputValue('')
    onSearch('')
    setShowSuggestions(false)
    inputRef.current?.focus()
  }, [onSearch])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && inputValue.trim()) {
      const updated = addToHistory(inputValue, history)
      setHistory(updated)
      setShowSuggestions(false)
    }
    if (e.key === 'Escape') {
      setShowSuggestions(false)
    }
  }

  const applyHistoryItem = (term: string) => {
    setInputValue(term)
    onSearch(term)
    setShowSuggestions(false)
    inputRef.current?.focus()
  }

  const removeHistoryItem = (
    e: React.MouseEvent,
    term: string
  ) => {
    e.stopPropagation()
    const updated = history.filter((h) => h !== term)
    setHistory(updated)
    saveHistory(updated)
  }

  const isFiltered = inputValue.trim().length > 0

  return (
    <div className="transaction-search" ref={containerRef}>
      <div className="search-input-wrapper">
        <Search size={16} className="search-icon" aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          className="search-input"
          placeholder="Search by ID, reference, provider…"
          value={inputValue}
          onChange={handleChange}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          aria-label="Search transactions"
          aria-autocomplete="list"
          aria-expanded={showSuggestions}
          autoComplete="off"
        />
        {inputValue && (
          <button
            className="search-clear"
            onClick={handleClear}
            aria-label="Clear search"
            type="button"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Result count pill */}
      {isFiltered && (
        <span className="search-result-count" aria-live="polite" role="status">
          {resultCount} of {totalCount} result{totalCount !== 1 ? 's' : ''}
        </span>
      )}

      {/* History suggestions */}
      {showSuggestions && history.length > 0 && (
        <ul className="search-suggestions" role="listbox" aria-label="Search history">
          <li className="suggestions-heading">
            <Clock size={12} aria-hidden="true" />
            Recent searches
          </li>
          {history.map((term) => (
            <li
              key={term}
              className="suggestion-item"
              role="option"
              aria-selected={false}
              onClick={() => applyHistoryItem(term)}
            >
              <Clock size={12} className="suggestion-icon" aria-hidden="true" />
              <span>{term}</span>
              <button
                className="suggestion-remove"
                onClick={(e) => removeHistoryItem(e, term)}
                aria-label={`Remove "${term}" from history`}
                type="button"
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Portal-wide search dialog ─────────────────────────────────────────────────

interface PortalSearchDialogProps {
  open: boolean
  onClose: () => void
  /** Optional navigation handler; defaults to window.location assignment */
  onNavigate?: (path: string) => void
}

export const PortalSearchDialog: React.FC<PortalSearchDialogProps> = ({
  open,
  onClose,
  onNavigate,
}) => {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const results = searchPortalPages(query)
  const groups = groupPortalPages(results)
  const flatResults = groups.flatMap((g) => g.pages)

  // Reset state and focus input when the dialog opens
  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIndex(0)
      inputRef.current?.focus()
    }
  }, [open])

  // Clamp active index when results change
  useEffect(() => {
    setActiveIndex((prev) =>
      flatResults.length === 0 ? 0 : Math.min(prev, flatResults.length - 1)
    )
  }, [flatResults.length])

  const navigate = useCallback(
    (path: string) => {
      if (onNavigate) {
        onNavigate(path)
      } else if (typeof window !== 'undefined') {
        window.location.assign(path)
      }
      onClose()
    },
    [onNavigate, onClose]
  )

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((prev) =>
        flatResults.length === 0 ? 0 : (prev + 1) % flatResults.length
      )
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((prev) =>
        flatResults.length === 0
          ? 0
          : (prev - 1 + flatResults.length) % flatResults.length
      )
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const target = flatResults[activeIndex]
      if (target) navigate(target.path)
    }
  }

  if (!open) return null

  let runningIndex = -1

  return (
    <div
      className="portal-search-overlay"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="portal-search-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Search portal pages"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="search-input-wrapper">
          <Search size={16} className="search-icon" aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            className="search-input"
            placeholder="Search guides, dashboards, settings…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActiveIndex(0)
            }}
            onKeyDown={handleKeyDown}
            aria-label="Search portal pages"
            aria-controls="portal-search-results"
            aria-activedescendant={
              flatResults[activeIndex]
                ? `portal-search-result-${activeIndex}`
                : undefined
            }
            autoComplete="off"
          />
          <button
            className="search-clear"
            onClick={onClose}
            aria-label="Close search"
            type="button"
          >
            <X size={14} />
          </button>
        </div>

        <div
          className="portal-search-results"
          id="portal-search-results"
          role="listbox"
          aria-label="Portal search results"
        >
          {flatResults.length === 0 && (
            <p className="portal-search-empty" role="status">
              No pages match “{query}”.
            </p>
          )}
          {groups.map((group) => (
            <div key={group.category} className="portal-search-group">
              <div className="portal-search-group-heading" role="presentation">
                {group.category}
              </div>
              {group.pages.map((page) => {
                runningIndex += 1
                const index = runningIndex
                const isActive = index === activeIndex
                return (
                  <a
                    key={page.path}
                    id={`portal-search-result-${index}`}
                    href={page.path}
                    className={`portal-search-result${
                      isActive ? ' is-active' : ''
                    }`}
                    role="option"
                    aria-selected={isActive}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={(e) => {
                      e.preventDefault()
                      navigate(page.path)
                    }}
                  >
                    <span className="portal-search-result-title">
                      <HighlightMatch text={page.title} query={query} />
                    </span>
                    <span className="portal-search-result-description">
                      {page.description}
                    </span>
                  </a>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
