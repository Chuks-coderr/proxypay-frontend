import { Profiler, useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useTransactionStore } from './stores/transactionStore'
import { useFeatureFlagStore } from './stores/featureFlagStore'
import { TransactionsTable } from './components/TransactionsTable'
import { TransactionDrawer } from './components/TransactionDrawer'
import { ExportButton } from './components/ExportButton'
import { NotificationSettings } from './components/NotificationSettings'
import { NotificationCenter } from './components/NotificationCenter'
import { canAccess } from './auth/access'
import './App.css'

type Page = 'transactions' | 'reconciliation' | 'settings'

interface PortalRoute {
  id: string
  label: string
  category: string
  page: Page
  keywords: string[]
}

const PORTAL_ROUTES: PortalRoute[] = [
  {
    id: 'transactions',
    label: 'Transaction History',
    category: 'Dashboards',
    page: 'transactions',
    keywords: ['transactions', 'history', 'payments', 'ledger'],
  },
  {
    id: 'reconciliation',
    label: 'Reconciliation',
    category: 'Dashboards',
    page: 'reconciliation',
    keywords: ['reconciliation', 'matching', 'duplicates', 'review'],
  },
  {
    id: 'settings',
    label: 'Notification Settings',
    category: 'Settings',
    page: 'settings',
    keywords: ['settings', 'notifications', 'alerts', 'preferences'],
  },
]

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>('transactions')
  const {
    selectedTransaction,
    setSelectedTransaction,
    detailLoading,
    fetchTransactionDetail,
    fetchTransactions,
    filters,
    transactions,
  } = useTransactionStore()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [fullPageTransaction, setFullPageTransaction] = useState(false)
  const canManageNotifications = canAccess('notification-settings')

  // Portal-wide page search — Issue #695
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const availableRoutes = useMemo(
    () => PORTAL_ROUTES.filter((route) => route.page !== 'settings' || canManageNotifications),
    [canManageNotifications],
  )

  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return availableRoutes
    return availableRoutes.filter((route) => {
      const haystack = [route.label, route.category, ...route.keywords].join(' ').toLowerCase()
      return haystack.includes(query)
    })
  }, [availableRoutes, searchQuery])

  const groupedResults = useMemo(() => {
    const groups = new Map<string, PortalRoute[]>()
    for (const route of searchResults) {
      const list = groups.get(route.category) ?? []
      list.push(route)
      groups.set(route.category, list)
    }
    return Array.from(groups.entries())
  }, [searchResults])

  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    setSearchQuery('')
    setActiveIndex(0)
  }, [])

  const navigateToRoute = useCallback(
    (route: PortalRoute) => {
      setCurrentPage(route.page)
      closeSearch()
    },
    [closeSearch],
  )

  // Global keyboard shortcut to open search (Cmd/Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Focus the input when the dialog opens
  useEffect(() => {
    if (searchOpen) {
      searchInputRef.current?.focus()
    }
  }, [searchOpen])

  // Keep the active index within bounds as results change
  useEffect(() => {
    setActiveIndex((index) => (index >= searchResults.length ? 0 : index))
  }, [searchResults.length])

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeSearch()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => (searchResults.length ? (index + 1) % searchResults.length : 0))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) =>
        searchResults.length ? (index - 1 + searchResults.length) % searchResults.length : 0,
      )
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const route = searchResults[activeIndex]
      if (route) navigateToRoute(route)
    }
  }

  // Initialize transactions on mount
  useEffect(() => {
    fetchTransactions(filters)
  }, [])

  const handleRowClick = (tx: Transaction) => {
    setSelectedTransaction(tx)
    setFullPageTransaction(false)
    setDrawerOpen(true)
    void fetchTransactionDetail(tx.id)
  }

  const handleDrawerClose = () => {
    setDrawerOpen(false)
    setFullPageTransaction(false)
    setTimeout(() => setSelectedTransaction(null), 300) // Delay to allow animation
  }

  const handleMerged = (result: TransactionMergeResult) => {
    setSelectedTransaction(result.transaction)
    void fetchTransactions(filters)
  }

  return (
    <div className="app">
      {/* Global toast notifications — Issue #447 */}
      <ToastNotifications />

      {/* Header Navigation */}
      <header className="app-header">
        <div className="header-content">
          <h1 className="app-title">ProxyPay Dashboard</h1>
          <button
            type="button"
            className="search-trigger"
            onClick={() => setSearchOpen(true)}
            aria-label="Search pages"
          >
            Search pages… <kbd>⌘K</kbd>
          </button>
          <NotificationCenter />
          <nav className="nav-tabs">
            <button
              className={`nav-tab ${currentPage === 'transactions' ? 'active' : ''}`}
              onClick={() => setCurrentPage('transactions')}
            >
              Transactions
            </button>
            {canManageNotifications && (
              <button
                className={`nav-tab ${currentPage === 'settings' ? 'active' : ''}`}
                onClick={() => setCurrentPage('settings')}
              >
                Notification Settings
              </button>
            )}
          </nav>
        </div>
      </header>

      {/* Portal-wide page search dialog — Issue #695 */}
      {searchOpen && (
        <div className="search-overlay" onClick={closeSearch}>
          <div
            className="search-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Search pages"
            onClick={(event) => event.stopPropagation()}
          >
            <input
              ref={searchInputRef}
              className="search-input"
              type="text"
              placeholder="Search guides, dashboards, and settings…"
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value)
                setActiveIndex(0)
              }}
              onKeyDown={handleSearchKeyDown}
              aria-label="Search pages"
            />
            <div className="search-results" role="listbox" aria-label="Search results">
              {groupedResults.length === 0 ? (
                <p className="search-empty">No pages match “{searchQuery}”.</p>
              ) : (
                groupedResults.map(([category, routes]) => (
                  <div key={category} className="search-group">
                    <div className="search-group-title">{category}</div>
                    {routes.map((route) => {
                      const index = searchResults.indexOf(route)
                      return (
                        <button
                          key={route.id}
                          type="button"
                          role="option"
                          aria-selected={index === activeIndex}
                          className={`search-result ${index === activeIndex ? 'active' : ''}`}
                          onMouseEnter={() => setActiveIndex(index)}
                          onClick={() => navigateToRoute(route)}
                        >
                          {route.label}
                        </button>
                      )
                    })}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="app-main">
        <Profiler id="dashboard-main" onRender={handleProfile}>
          {currentPage === 'transactions' ? (
            <div className="transactions-page">
              <div className="page-header">
                <h2>Transaction History</h2>
                <ExportButton />
              </div>
              <TransactionsTable onRowClick={handleRowClick} loadOnMount={false} />
              <DuplicateReview transactions={transactions} onMerged={handleMerged} />
            </div>
          ) : currentPage === 'reconciliation' ? (
            <div className="reconciliation-page">
              <ReconciliationTab />
            </div>
          ) : canManageNotifications ? (
            <div className="settings-page">
              <NotificationSettings />
            </div>
          ) : null}
        </Profiler>
      </main>

      {/* Transaction Detail Drawer */}
      <TransactionDrawer
        transaction={selectedTransaction}
        isOpen={drawerOpen}
        loading={detailLoading}
        error={detailError}
        onClose={handleDrawerClose}
        fullPage={fullPageTransaction}
        onOpenFullPage={() => setFullPageTransaction(true)}
      />
      {showWarning && (
        <SessionExpirationDialog
          secondsRemaining={secondsRemaining}
          onExtend={() => void extendSession()}
          onSignOut={signOut}
        />
      )}
    </div>
  )
}
