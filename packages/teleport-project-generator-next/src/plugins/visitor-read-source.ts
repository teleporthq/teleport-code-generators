/**
 * `readAsVisitor(fetcher, params)`, for a plugin's PUBLIC route (the search,
 * the comparison): the rows of a table as a visitor is served them. The read
 * goes through the table route's handler without the server-call marker, so
 * the visitor row policy applies — only published posts, only active
 * products, never a hidden column — exactly as for the storefront's own
 * reads. The fetcher's `fetchData` would read as the server does: every row.
 */
export const VISITOR_READ_SOURCE = `// The rows as a visitor is served them: the table route's own policy applies.
async function readAsVisitor(fetcher, params) {
  const req = { query: params, method: 'GET', headers: {}, cookies: {} }
  let status = 200
  let result = null
  const res = {
    status: (code) => {
      status = code
      return res
    },
    json: (data) => {
      result = data
      return res
    },
    setHeader: () => res,
  }
  await fetcher.handler(req, res)
  if (status !== 200 || !result || !result.success) {
    throw new Error((result && result.error) || 'The rows could not be read')
  }
  return result.data
}`
