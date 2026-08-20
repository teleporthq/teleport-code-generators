/**
 * ISR window for pages whose `getStaticProps` reads data-source rows.
 *
 * ## ⛔ THE DEFECT (run c133d485, "/blog")
 *
 * A page with a PAGINATED or SEARCHABLE data source gets its `getStaticProps`
 * bootstrapped by `index.ts` (an empty `Promise.all` + `return { props: {} }`)
 * which the pagination plugin then fills in. That bootstrap shipped without a
 * `revalidate`, so the page became a pure build-time snapshot — while the
 * near-identical shape created by `utils.ts` (for a page whose data source is
 * neither paginated nor searchable) has always carried `revalidate: 1`. Same
 * kind of page, opposite caching, decided by whether a pagination control
 * happened to be on it.
 *
 * What that cost, measured on the deployed site: the blog list fetched
 * `status = 'published'` correctly and STILL showed a draft post. The row was
 * published when the site was built, was later moved back to draft, and the CDN
 * kept serving the build-time HTML (`x-vercel-cache: HIT`) forever. The client
 * cannot correct it either — `DataProvider` is seeded with `initialData` for
 * page 1, so it does not refetch. Every list page had the same hole: a new
 * product, a cancelled order, a deleted review — none of them would ever reach
 * the first page of the list without a redeploy.
 *
 * One second matches what the non-paginated path already does, so the two
 * creation sites cannot drift again. Pages that are converted to
 * `getServerSideProps` (admin CRUD) have this stripped by
 * `entity-mutation-ssr-finalize-plugin`, where `revalidate` is invalid.
 */
export const DATA_SOURCE_ISR_REVALIDATE_SECONDS = 1
