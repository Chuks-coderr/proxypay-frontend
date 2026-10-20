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
 * Relevance tiers used to rank search results. Higher is more relevant.
 * Exact matches on structured fields rank above prefix matches, which in
 * turn rank above incidental substring matches.
 */
export const SEARCH_RANK = {
  EXACT: 3,
  PREFIX: 2,
  SUBSTRING: 1,
  NONE: 0,
} as const

/**
 * Scores a single field against the query, returning the best relevance tier.
 * Exact match > prefix match > substring match > no match.
 */
function scoreField(value: string, q: string): number {
  const v = value.toLowerCase()
  if (v === q) return SEARCH_RANK.EXACT
  if (v.startsWith(q)) return SEARCH_RANK.PREFIX
  if (v.includes(q)) return SEARCH_RANK.SUBSTRING
  return SEARCH_RANK.NONE
}

/**
 * Computes a relevance score for a transaction against the query.
 * Structured fields (id, reference, provider) are ranked by their best tier.
 * Returns 0 when the transaction does not match at all.
 */
export function searchRelevance(tx: Transaction, query: string): number {
  if (!query.trim()) return SEARCH_RANK.NONE
  const q = query.toLowerCase().trim()
  return Math.max(
    scoreField(tx.id, q),
    scoreField(tx.reference, q),
    scoreField(tx.provider, q)
  )
}

/**
 * Filters and ranks transactions by relevance to the query.
 * Preserves the existing inclusion behavior of `matchesSearch` while
 * ordering exact and prefix matches ahead of broad substring matches.
 * Ties are broken deterministically by id.
 */
export function rankTransactions(
  transactions: Transaction[],
  query: string
): Transaction[] {
  if (!query.trim()) return transactions
  return transactions
    .filter((tx) => matchesSearch(tx, query))
    .map((tx) => ({ tx, score: searchRelevance(tx, query) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.tx.id.localeCompare(b.tx.id)
    })
    .map(({ tx }) => tx)
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

interface TransactionSearchProps {
  onSelect?: (operation: Operation | null) => void;
}

const SEARCH_PARAM = 'q';
const OPERATION_PARAM = 'op';
const DEPRECATED_PARAM = 'deprecated';

const TransactionSearch: React.FC<TransactionSearchProps> = ({ onSelect }) => {
  const { operations } = useApiData();
  const history = useHistory();
  const location = useLocation();

  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const searchQuery = params.get(SEARCH_PARAM) ?? '';
  const selectedOperationId = params.get(OPERATION_PARAM);
  const showDeprecated = params.get(DEPRECATED_PARAM) === 'true';

  const [inputValue, setInputValue] = useState(searchQuery);
  const [revealHidden, setRevealHidden] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    setInputValue(searchQuery);
  }, [searchQuery]);

  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(location.search);
      Object.entries(updates).forEach(([key, value]) => {
        if (value === null || value === '') {
          next.delete(key);
        } else {
          next.set(key, value);
        }
      });
      const query = next.toString();
      history.replace({ ...location, search: query ? `?${query}` : '' });
    },
    [history, location]
  );

  const matchesFilters = useCallback(
    (operation: Operation) => {
      if (!showDeprecated && operation.deprecated) {
        return false;
      }
      if (!searchQuery) {
        return true;
      }
      const haystack = [
        getOperationId(operation),
        getOperationPath(operation),
        operation.summary,
        operation.description,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(searchQuery.toLowerCase());
    },
    [searchQuery, showDeprecated]
  );

  const selectedOperation = useMemo(
    () => operations.find((op) => getOperationId(op) === selectedOperationId) ?? null,
    [operations, selectedOperationId]
  );

  const selectedIsHidden = selectedOperation !== null && !matchesFilters(selectedOperation);

  const visibleOperations = useMemo(() => {
    const filtered = operations.filter(matchesFilters);
    if (selectedOperation && selectedIsHidden && revealHidden) {
      return [selectedOperation, ...filtered];
    }
    return filtered;
  }, [operations, matchesFilters, selectedOperation, selectedIsHidden, revealHidden]);

  useEffect(() => {
    if (!selectedOperation || !listRef.current) {
      return;
    }
    const node = listRef.current.querySelector<HTMLElement>(
      `[data-operation-id="${CSS.escape(getOperationId(selectedOperation))}"]`
    );
    node?.scrollIntoView({ block: 'nearest' });
  }, [selectedOperation, visibleOperations]);

  const handleSelect = useCallback(
    (operation: Operation) => {
      const id = getOperationId(operation);
      const isSame = id === selectedOperationId;
      updateParams({ [OPERATION_PARAM]: isSame ? null : id });
      onSelect?.(isSame ? null : operation);
    },
    [selectedOperationId, updateParams, onSelect]
  );

  const handleSearchChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setInputValue(value);
      setRevealHidden(false);
      updateParams({ [SEARCH_PARAM]: value || null });
    },
    [updateParams]
  );

  const handleDeprecatedToggle = useCallback(() => {
    setRevealHidden(false);
    updateParams({ [DEPRECATED_PARAM]: showDeprecated ? null : 'true' });
  }, [showDeprecated, updateParams]);

  const handleRevealSelected = useCallback(() => {
    setRevealHidden(true);
  }, []);

  return (
    <div className={styles.container}>
      <div className={styles.controls}>
        <input
          type="search"
          className={styles.searchInput}
          placeholder="Search endpoints..."
          value={inputValue}
          onChange={handleSearchChange}
          aria-label="Search endpoints"
        />
        <label className={styles.deprecatedToggle}>
          <input type="checkbox" checked={showDeprecated} onChange={handleDeprecatedToggle} />
          Show deprecated
        </label>
      </div>

      {selectedIsHidden && !revealHidden && (
        <div className={styles.hiddenNotice} role="status">
          <span>
            The selected endpoint <strong>{getOperationId(selectedOperation!)}</strong> is hidden by
            the active filters.
          </span>
          <button type="button" className={styles.revealButton} onClick={handleRevealSelected}>
            Reveal selected endpoint
          </button>
        </div>
      )}

      {visibleOperations.length === 0 ? (
        <p className={styles.emptyState}>No endpoints match the current filters.</p>
      ) : (
        <ul className={styles.list} ref={listRef}>
          {visibleOperations.map((operation) => {
            const id = getOperationId(operation);
            const isSelected = id === selectedOperationId;
            return (
              <li key={id}>
                <button
                  type="button"
                  data-operation-id={id}
                  className={clsx(styles.item, isSelected && styles.itemSelected)}
                  aria-current={isSelected ? 'true' : undefined}
                  onClick={() => handleSelect(operation)}
                >
                  <span className={styles.method}>{operation.method.toUpperCase()}</span>
                  <span className={styles.path}>{getOperationPath(operation)}</span>
                  {operation.summary && <span className={styles.summary}>{operation.summary}</span>}
                  {operation.deprecated && <span className={styles.deprecatedBadge}>Deprecated</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default TransactionSearch;
