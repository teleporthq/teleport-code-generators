export type Modify<T, R> = Omit<T, keyof R> & R
export type ModifyUnionNumber<T, U, V> = T extends U ? V : T
