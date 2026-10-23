import { OwnerColumns } from '../../src'

const {
  ownerColumnPriority,
  userIdRole,
  attributionKind,
  resolveOwnerColumn,
  generateOwnerColumnResolverCode,
} = OwnerColumns

type Resolver = typeof resolveOwnerColumn

const table = (...names: string[]) =>
  names.map((name, index) => ({ name, ordinalPosition: index + 1 }))

/**
 * The one decision "which column makes a row mine", shared by the AI
 * pipeline's per-user page scoping (teleport-services-worker imports it) and
 * the generated account-delete route (which ships it as text). Every scenario
 * runs against the TypeScript function AND the shipped text, so the two can
 * never answer differently.
 */
const resolvers: Array<[string, Resolver]> = [
  ['the TypeScript function', resolveOwnerColumn],
  [
    'the text shipped inside generated projects',
    // tslint:disable-next-line:function-constructor
    new Function(`${generateOwnerColumnResolverCode()}; return resolveOwnerColumn;`)(),
  ],
]

describe.each(resolvers)('resolveOwnerColumn — %s', (_label, resolve) => {
  it('takes the first present priority name, whatever the column order', () => {
    expect(ownerColumnPriority()).toEqual([
      'user_id',
      'owner_id',
      'member_id',
      'account_id',
      'customer_id',
      'created_by',
    ])
    expect(resolve(table('id', 'created_by', 'user_id'))).toEqual({
      column: 'user_id',
      kind: 'owner',
    })
    expect(resolve(table('id', 'owner_user_id', 'user_id'))).toEqual({
      column: 'user_id',
      kind: 'owner',
    })
    expect(resolve(table('id', 'customer_id', 'member_id'))).toEqual({
      column: 'member_id',
      kind: 'owner',
    })
  })

  it('then the first <role>_user_id column in column order, as an owner or an actor', () => {
    // The approver leaving must not take the expenses they approved with them.
    expect(resolve(table('id', 'submitter_user_id', 'approved_by_user_id', 'amount'))).toEqual({
      column: 'submitter_user_id',
      kind: 'owner',
    })
    // A seller leaving must not take the buyers' inquiries with them.
    expect(resolve(table('id', 'sender_user_id', 'recipient_user_id', 'body'))).toEqual({
      column: 'sender_user_id',
      kind: 'owner',
    })
    // Column order decides, exactly as the page does; an acting role is an actor.
    expect(resolve(table('id', 'approved_by_user_id', 'submitter_user_id'))).toEqual({
      column: 'approved_by_user_id',
      kind: 'actor',
    })
    expect(resolve(table('id', 'reviewer_user_id', 'product_id'))).toEqual({
      column: 'reviewer_user_id',
      kind: 'actor',
    })
  })

  it('then the first attribution column in column order', () => {
    expect(resolve(table('id', 'author_id', 'body'))).toEqual({
      column: 'author_id',
      kind: 'owner',
    })
    expect(resolve(table('id', 'title', 'assigned_to', 'updated_by'))).toEqual({
      column: 'assigned_to',
      kind: 'actor',
    })
    expect(resolve(table('id', 'updated_by', 'submitted_by'))).toEqual({
      column: 'updated_by',
      kind: 'actor',
    })
  })

  it('answers null for a table nobody owns', () => {
    expect(resolve(table('id', 'name', 'price', 'product_id'))).toBeNull()
    expect(resolve([])).toBeNull()
  })

  it('orders by ordinal position and returns the column as it is spelled', () => {
    expect(
      resolve([
        { name: 'recipient_user_id', ordinalPosition: 3 },
        { name: 'sender_user_id', ordinalPosition: 2 },
      ])
    ).toEqual({ column: 'sender_user_id', kind: 'owner' })
    expect(resolve(table('ID', 'Author_Id'))).toEqual({ column: 'Author_Id', kind: 'owner' })
    expect(resolve(table('id', ' User_Id '))).toEqual({ column: ' User_Id ', kind: 'owner' })
  })
})

describe('attributionKind — owner, actor, or not an attribution at all', () => {
  it('owner: the row is theirs', () => {
    for (const name of [
      ...ownerColumnPriority(),
      'owned_by',
      'author_id',
      'creator_id',
      'submitted_by',
      'posted_by',
      'authored_by',
      'uploaded_by',
      'added_by',
      'requested_by',
      'author_user_id',
      'owner_user_id',
      'sender_user_id',
      'submitter_user_id',
      'created_by_user_id',
      'User_Id',
    ]) {
      expect([name, attributionKind(name)]).toEqual([name, 'owner'])
    }
  })

  it("actor: they acted on somebody else's row", () => {
    for (const name of [
      'assigned_to',
      'assignee_id',
      'assigned_by',
      'approved_by',
      'reviewed_by',
      'updated_by',
      'edited_by',
      'modified_by',
      'deleted_by',
      'approved_by_user_id',
      'reviewer_user_id',
      'recipient_user_id',
      'assignee_user_id',
      'last_edited_by_user_id',
      'to_user_id',
    ]) {
      expect([name, attributionKind(name)]).toEqual([name, 'actor'])
    }
  })

  it('null: not an attribution column', () => {
    for (const name of ['id', 'product_id', 'user', 'userid', 'email', '_user_id', 'users_id']) {
      expect([name, attributionKind(name)]).toEqual([name, null])
    }
    expect(userIdRole('approved_by_user_id')).toBe('approved_by')
    expect(userIdRole('user_id')).toBeNull()
  })
})
