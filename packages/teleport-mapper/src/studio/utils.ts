export const orderEntities = (entityA: Record<string, string>, entityB: Record<string, string>) => {
  if (!entityA || !entityA.pos) {
    return -1
  }

  if (!entityB || !entityB.pos) {
    return 1
  }

  const numA = parseFloat(entityA.pos)
  const numB = parseFloat(entityB.pos)

  return precisionRound(numA) - precisionRound(numB)
}

export const precisionRound = (numberToCompute: number, precision = 100) => {
  const factor = Math.pow(10, precision)
  return Math.round(numberToCompute * factor) / factor
}

export const computeCustomPropertyName = (
  token: Record<string, string>,
  categories: Record<string, Record<string, string>>
) => {
  if (token.categoryId) {
    const categoryName = categories[token.categoryId].name.toLowerCase().replace(/ /g, '')
    const tokenName = token.name.toLowerCase().replace(/ /g, '')
    return `--dl-${token.type}-${categoryName}-${tokenName}`
  } else {
    return `--dl-${token.type}-${token.name.toLowerCase()}`
  }
}
