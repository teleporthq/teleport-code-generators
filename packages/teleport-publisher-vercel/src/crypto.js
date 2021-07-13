export const encryptFileData = async (fileData) =>  {
    const digest = await crypto.subtle.digest('SHA-1', fileData)
    return digest
}