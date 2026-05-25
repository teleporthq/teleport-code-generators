export const validateDatabaseConfig = (
  config: Record<string, unknown>
): { isValid: boolean; error?: string } => {
  if (!config || typeof config !== 'object') {
    return { isValid: false, error: 'Config must be a valid object' }
  }

  // If connectionString is provided, skip individual field checks
  if (config.connectionString) {
    if (typeof config.connectionString !== 'string' || config.connectionString.trim() === '') {
      return { isValid: false, error: 'connectionString must be a non-empty string' }
    }
    return { isValid: true }
  }

  if (!config.host || typeof config.host !== 'string' || config.host.trim() === '') {
    return { isValid: false, error: 'Host is required and must be a non-empty string' }
  }

  if (config.port !== undefined) {
    const port = Number(config.port)
    if (isNaN(port) || port < 1 || port > 65535) {
      return { isValid: false, error: 'Port must be a number between 1 and 65535' }
    }
  }

  if (!config.user && !config.username) {
    return { isValid: false, error: 'User or username is required' }
  }

  if (!config.password || typeof config.password !== 'string') {
    return { isValid: false, error: 'Password is required' }
  }

  if (!config.database || typeof config.database !== 'string' || config.database.trim() === '') {
    return { isValid: false, error: 'Database name is required' }
  }

  return { isValid: true }
}
