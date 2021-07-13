
const { createHash } = require('crypto')

export const encryptFileData = (fileData) => {
    const hash = createHash('SHA1')
    hash.update(fileData)
    return hash.digest()
}