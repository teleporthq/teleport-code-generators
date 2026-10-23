import { OwnerColumns } from '../../src'

const { OWNER_COLUMN_NAMES, OWNER_COLUMN_SUFFIX, isOwnerColumn } = OwnerColumns

/**
 * The one vocabulary of "which column names the row's owner", shared by the
 * AI pipeline's per-user page scoping (teleport-services-worker keeps a drift
 * test against this export) and the generated account-delete route.
 */
describe('owner columns — the vocabulary the pipeline and the generated routes share', () => {
  it("is the pipeline's list, in its priority order, plus the <entity>_user_id convention", () => {
    expect(OWNER_COLUMN_NAMES).toEqual([
      'user_id',
      'owner_id',
      'member_id',
      'account_id',
      'customer_id',
      'created_by',
    ])
    expect(OWNER_COLUMN_SUFFIX).toBe('_user_id')
  })

  it('recognises every name and the convention, whatever the case or padding', () => {
    for (const name of OWNER_COLUMN_NAMES) {
      expect(isOwnerColumn(name)).toBe(true)
    }
    expect(isOwnerColumn('owner_user_id')).toBe(true)
    expect(isOwnerColumn('author_user_id')).toBe(true)
    expect(isOwnerColumn('User_Id')).toBe(true)
    expect(isOwnerColumn(' user_id ')).toBe(true)
  })

  it('does not take an actor, audit or domain link for an owner', () => {
    for (const name of [
      'assigned_to',
      'assignee_id',
      'updated_by',
      'approved_by',
      'reviewed_by',
      'deleted_by',
      'product_id',
      'userid',
      'user',
      'id',
    ]) {
      expect(isOwnerColumn(name)).toBe(false)
    }
  })
})
