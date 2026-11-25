

import { useCallback, useEffect, useState } from "react"
import {
  QueryClient,
  QueryClientProvider,
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { ReactQueryDevtools } from "@tanstack/react-query-devtools"

/* ───────────────────────── API ───────────────────────── */

const BASE_URL = "https://dummyjson.com"
const FIELDS = "firstName,lastName,email,phone,age,gender,company,address"

async function api(path, params) {
  const url = new URL(BASE_URL + path)
  for (const [k, v] of Object.entries(params)) {
    if (v !== "" && v != null) url.searchParams.set(k, v)
  }
  const res = await fetch(url)
  if (!res.ok) throw new Error(`The server responded with status ${res.status}.`)
  return res.json()
}

// One function for list, search and filter (DummyJSON uses a different endpoint for each).
// The API can't combine search and filter, so search wins if both are set.
function fetchUsers({ page, pageSize, sortBy, order, q, gender }) {
  const base = {
    limit: pageSize,
    skip: (page - 1) * pageSize,
    select: FIELDS,
    ...(sortBy ? { sortBy, order } : {}),
  }
  if (q) return api("/users/search", { ...base, q })
  if (gender) return api("/users/filter", { ...base, key: "gender", value: gender })
  return api("/users", base)
}

/* ───────────────────────── Hooks ───────────────────────── */

function useDebounce(value, delay = 400) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return debounced
}

const PAGE_SIZES = [10, 20, 50]
const DEFAULTS = { page: 1, pageSize: 10, sortBy: "", order: "asc", q: "", gender: "" }

function readParams() {
  const sp = new URLSearchParams(window.location.search)
  const size = parseInt(sp.get("pageSize"), 10)
  const gender = sp.get("gender")
  return {
    page: Math.max(1, parseInt(sp.get("page"), 10) || 1),
    pageSize: PAGE_SIZES.includes(size) ? size : DEFAULTS.pageSize,
    sortBy: sp.get("sortBy") || "",
    order: sp.get("order") === "desc" ? "desc" : "asc",
    q: sp.get("q") || "",
    gender: gender === "female" || gender === "male" ? gender : "",
  }
}

// All table state lives in the URL → shareable links, Back/Forward work.
function useTableParams() {
  const [params, setParams] = useState(readParams)

  useEffect(() => {
    const onPop = () => setParams(readParams())
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [])

  const update = useCallback((patch) => {
    const next = { ...readParams(), ...patch }
    if (!("page" in patch)) next.page = 1 // any change except the page itself resets to page 1
    const sp = new URLSearchParams()
    for (const [k, v] of Object.entries(next)) if (v !== DEFAULTS[k]) sp.set(k, v)
    const qs = sp.toString()
    window.history.pushState(null, "", qs ? `?${qs}` : window.location.pathname)
    setParams(next)
  }, [])

  return { params, update }
}

/* ───────────────────────── Query ───────────────────────── */

const userKeys = { list: (params) => ["users", "list", params] }
const STALE_MS = 30_000

function useUsers(params) {
  const client = useQueryClient()

  const query = useQuery({
    queryKey: userKeys.list(params),
    queryFn: () => fetchUsers(params),
    placeholderData: keepPreviousData, // no skeleton flash when changing pages
    staleTime: STALE_MS,
  })

  // prefetch the next page
  const totalPages = query.data ? Math.ceil(query.data.total / params.pageSize) : 0
  useEffect(() => {
    if (query.data && params.page < totalPages) {
      const next = { ...params, page: params.page + 1 }
      client.prefetchQuery({
        queryKey: userKeys.list(next),
        queryFn: () => fetchUsers(next),
        staleTime: STALE_MS,
      })
    }
  }, [query.data, params, totalPages, client])

  return query
}

/* ───────────────────────── Small components ───────────────────────── */

function ErrorState({ message, onRetry, retrying }) {
  return (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-8 text-center">
      <h2 className="text-lg font-semibold text-red-900">Couldn't load members</h2>
      <p className="mt-1 text-sm text-red-800">{message}</p>
      <button
        onClick={() => onRetry()}
        disabled={retrying}
        className="mt-4 rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {retrying ? "Retrying…" : "Try again"}
      </button>
    </div>
  )
}

function EmptyState({ onClear }) {
  return (
    <div className="rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center">
      <h2 className="text-lg font-semibold">No members match</h2>
      <p className="mt-1 text-sm text-stone-600">Try a different name, or remove the current search and filters.</p>
      <button onClick={onClear} className="mt-4 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white">
        Clear search and filters
      </button>
    </div>
  )
}

function SortableHeader({ label, field, sortBy, order, onSort }) {
  const active = sortBy === field
  const ariaSort = active ? (order === "asc" ? "ascending" : "descending") : "none"
  return (
    <th scope="col" aria-sort={ariaSort} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-emerald-900">
      <button
        type="button"
        onClick={() => onSort(field)}
        className="inline-flex items-center gap-1.5 rounded hover:text-emerald-800"
      >
        {label}
        <span aria-hidden="true" className={active ? "text-emerald-700" : "text-stone-400"}>
          {active ? (order === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  )
}

/* ───────────────────────── Toolbar ───────────────────────── */

const inputCls = "rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"

function TableToolbar({ params, update, query }) {
  const { q, gender, pageSize } = params
  const [text, setText] = useState(q)
  const debounced = useDebounce(text, 400)

  useEffect(() => setText(q), [q]) // stay in sync with the URL (Back, Clear)

  useEffect(() => {
    const term = debounced.trim()
    if (term !== q) update({ q: term, gender: term ? "" : gender }) // one request after the pause
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced])

  const { data, isFetching } = query
  let summary = "Loading members…"
  if (data) {
    const from = data.total === 0 ? 0 : data.skip + 1
    const to = data.skip + data.users.length
    summary = q
      ? `Showing ${from}–${to} of ${data.total} results for '${q}'`
      : `Showing ${from}–${to} of ${data.total} members`
  }

  return (
    <div className="space-y-3 rounded-2xl border border-white bg-white/90 p-5 shadow-md ring-1 ring-stone-200">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <label htmlFor="search" className="mb-1 block text-sm font-medium">Search members</label>
          <div className="relative">
            <input
              id="search"
              type="search"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Name, e.g. emily"
              className={`${inputCls} w-full pr-9 [&::-webkit-search-cancel-button]:hidden`}
            />
            {text && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => { setText(""); update({ q: "" }) }}
                className="absolute inset-y-0 right-0 rounded-r-lg px-3 text-stone-500 hover:text-stone-900"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        <div>
          <label htmlFor="gender" className="mb-1 block text-sm font-medium">Gender</label>
          <select
            id="gender"
            value={gender}
            onChange={(e) => { setText(""); update({ gender: e.target.value, q: "" }) }}
            className={inputCls}
          >
            <option value="">All</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
          </select>
        </div>

        <div>
          <label htmlFor="pageSize" className="mb-1 block text-sm font-medium">Rows per page</label>
          <select
            id="pageSize"
            value={pageSize}
            onChange={(e) => update({ pageSize: Number(e.target.value) })}
            className={inputCls}
          >
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>

      <p className="text-xs text-stone-500">
        Search and the gender filter can't be combined: using one clears the other.
      </p>

      <div className="flex items-center gap-3">
        <p className="text-sm font-medium text-stone-700" aria-live="polite">{summary}</p>
        {isFetching && (
          <span role="status" className="animate-pulse rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
            Updating…
          </span>
        )}
      </div>
    </div>
  )
}

/* ───────────────────────── Table ───────────────────────── */

const COLUMNS = [
  { key: "name", label: "Name", sort: "firstName", skeleton: 130 },
  { key: "email", label: "Email", sort: "email", skeleton: 180 },
  { key: "phone", label: "Phone", skeleton: 110 },
  { key: "age", label: "Age", sort: "age", skeleton: 30 },
  { key: "gender", label: "Gender", sort: "gender", skeleton: 60 },
  { key: "company", label: "Company", skeleton: 120 },
  { key: "city", label: "City", skeleton: 90 },
]
const cellCls = "px-4 py-3 whitespace-nowrap"

function UsersTable({ params, update, query }) {
  const { data, isPending, isError, error, refetch, isFetching, isPlaceholderData } = query
  const { sortBy, order } = params

  const onSort = (field) =>
    update(sortBy === field ? { order: order === "asc" ? "desc" : "asc" } : { sortBy: field, order: "asc" })

  if (isError) return <ErrorState message={error.message} onRetry={refetch} retrying={isFetching} />
  if (data && data.users.length === 0) return <EmptyState onClear={() => update({ q: "", gender: "" })} />

  return (
    // Responsive choice: horizontal scroll + sticky name column (keeps all data and real table semantics)
    <div className="overflow-x-auto rounded-2xl border border-white bg-white shadow-md ring-1 ring-stone-200">
      <table className="min-w-full divide-y divide-stone-200 text-sm" aria-busy={isFetching}>
        <caption className="sr-only">Cooperative members. Column headings with buttons are sortable.</caption>
        <thead className="bg-emerald-50">
          <tr>
            {COLUMNS.map((c) =>
              c.sort ? (
                <SortableHeader key={c.key} label={c.label} field={c.sort} sortBy={sortBy} order={order} onSort={onSort} />
              ) : (
                <th key={c.key} scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-emerald-900">{c.label}</th>
              )
            )}
          </tr>
        </thead>
        <tbody className={`divide-y divide-stone-100 text-stone-700 transition-opacity ${isPlaceholderData ? "opacity-50" : ""}`}>
          {isPending
            ? Array.from({ length: Math.min(params.pageSize, 10) }).map((_, r) => (
                <tr key={r} aria-hidden="true">
                  {COLUMNS.map((c, i) => (
                    <td key={c.key} className={`${cellCls} ${i === 0 ? "sticky left-0 bg-white" : ""}`}>
                      <div className="h-4 animate-pulse rounded bg-stone-200" style={{ width: c.skeleton }} />
                    </td>
                  ))}
                </tr>
              ))
            : data.users.map((u) => (
                <tr key={u.id} className="group hover:bg-emerald-50">
                  <th scope="row" className={`${cellCls} sticky left-0 bg-white text-left font-medium text-stone-900 group-hover:bg-emerald-50`}>
                    <div className="flex items-center gap-3">
                      <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-xs font-bold text-white">
                        {u.firstName[0]}{u.lastName[0]}
                      </span>
                      {u.firstName} {u.lastName}
                    </div>
                  </th>
                  <td className={`${cellCls} text-emerald-800`}>{u.email}</td>
                  <td className={cellCls}>{u.phone}</td>
                  <td className={`${cellCls} tabular-nums`}>{u.age}</td>
                  <td className={cellCls}>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${u.gender === "female" ? "bg-rose-100 text-rose-800" : "bg-sky-100 text-sky-800"}`}>
                      {u.gender}
                    </span>
                  </td>
                  <td className={`${cellCls} font-medium`}>{u.company?.name}</td>
                  <td className={`${cellCls} text-stone-500`}>{u.address?.city}</td>
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  )
}

/* ───────────────────────── Pagination ───────────────────────── */

function getPages(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages = [1]
  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)
  if (start > 2) pages.push("…")
  for (let i = start; i <= end; i++) pages.push(i)
  if (end < total - 1) pages.push("…")
  pages.push(total)
  return pages
}

const pageBtn = "min-w-10 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors hover:border-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"

function TablePagination({ params, update, total }) {
  const totalPages = Math.ceil(total / params.pageSize)
  if (totalPages <= 1) return null
  const { page } = params
  const go = (p) => update({ page: p })

  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-center gap-1.5">
      <button className={`${pageBtn} border-stone-300 bg-white`} disabled={page <= 1} onClick={() => go(page - 1)}>
        Previous
      </button>
      {getPages(page, totalPages).map((p, i) =>
        p === "…" ? (
          <span key={`gap-${i}`} aria-hidden="true" className="px-1 text-stone-500">…</span>
        ) : (
          <button
            key={p}
            onClick={() => go(p)}
            aria-current={p === page ? "page" : undefined}
            aria-label={`Page ${p}`}
            className={`${pageBtn} ${p === page ? "border-emerald-700 bg-emerald-700 text-white shadow-md" : "border-stone-300 bg-white"}`}
          >
            {p}
          </button>
        )
      )}
      <button className={`${pageBtn} border-stone-300 bg-white`} disabled={page >= totalPages} onClick={() => go(page + 1)}>
        Next
      </button>
    </nav>
  )
}

/* ───────────────────────── App ───────────────────────── */

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
})

const globalCss = `
  @import url("https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400;500;600;700&display=swap");
  body { font-family: "Schibsted Grotesk", system-ui, sans-serif; background: radial-gradient(900px 380px at 0% -5%, #d1fae5 0%, transparent 65%), radial-gradient(700px 320px at 100% 0%, #ccfbf1 0%, transparent 60%), #f6f7f4; color: #1c1917; }
  :focus-visible { outline: 2px solid #047857; outline-offset: 2px; }
`

function MembersPage() {
  const { params, update } = useTableParams()
  const query = useUsers(params)

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-8 overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-900 via-emerald-700 to-teal-600 p-6 text-white shadow-lg sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-200">Kigali cooperative</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">Abanyamuryango</h1>
            <p className="mt-1 text-emerald-100">Members directory</p>
          </div>
          {query.data && (
            <div className="rounded-xl bg-white/15 px-5 py-3 text-center ring-1 ring-white/25 backdrop-blur">
              <p className="text-3xl font-bold leading-none">{query.data.total}</p>
              <p className="mt-1 text-xs uppercase tracking-wide text-emerald-100">{params.q || params.gender ? "matches" : "members"}</p>
            </div>
          )}
        </div>
      </header>
      <div className="space-y-4">
        <TableToolbar params={params} update={update} query={query} />
        <UsersTable params={params} update={update} query={query} />
        <TablePagination params={params} update={update} total={query.data?.total ?? 0} />
      </div>
    </main>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <style>{globalCss}</style>
      <MembersPage />
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  )
}