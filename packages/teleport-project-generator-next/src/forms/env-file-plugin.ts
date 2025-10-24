import { ProjectPlugin, ProjectPluginStructure, GeneratedFile } from '@teleporthq/teleport-types'

/**
 * This plugin generates a .env.example file with the FORMS_API_URL variable
 * when forms are defined in the project UIDL.
 */
export class NextFormsEnvFilePlugin implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    const { uidl, rootFolder } = structure

    // Skip if no forms are defined
    if (!uidl.forms || !uidl.forms.items || Object.keys(uidl.forms.items).length === 0) {
      return structure
    }

    // Check if .env.example already exists
    const existingEnvFile = rootFolder.files.find(
      (file) => file.name === '.env' && file.fileType === 'example'
    )

    let envContent = ''
    const envVars: string[] = []

    // Add FORMS_API_URL if not using formsServerUrl, or if formsServerUrl is an env variable
    if (!uidl.forms.formsServerUrl) {
      envVars.push(`# Form Submission API URL
# This URL will be used to submit form data from your Next.js application
# Replace this with your actual forms API endpoint
NEXT_PUBLIC_FORMS_API_URL=https://your-forms-api.example.com/submit`)
    } else if (uidl.forms.formsServerUrl.type === 'env') {
      const envVarName = uidl.forms.formsServerUrl.content
      envVars.push(`# Form Submission API URL
# This URL will be used to submit form data from your Next.js application
# Replace this with your actual forms API endpoint
${envVarName}=https://your-forms-api.example.com/submit`)
    }

    // Add captcha public key if using env value
    const captchaKey = uidl.forms.globalConfig?.defaultCaptchaPublicKey
    if (captchaKey?.type === 'env') {
      const envVarName = captchaKey.content
      envVars.push(`\n# Captcha Public Key
# Get this from your captcha provider (reCAPTCHA, hCaptcha, or Turnstile)
${envVarName}=your_captcha_public_key_here`)
    }

    // Check for per-form captcha keys
    Object.values(uidl.forms.items).forEach((form) => {
      if (form.security?.captchaPublicKey?.type === 'env') {
        const envVarName = form.security.captchaPublicKey.content
        if (!envVars.some((v) => v.includes(envVarName))) {
          envVars.push(`\n# Captcha Public Key for ${form.name.content}
${envVarName}=your_captcha_public_key_here`)
        }
      }
    })

    if (envVars.length === 0) {
      return structure
    }

    const newEnvContent = envVars.join('\n') + '\n'

    if (existingEnvFile) {
      // Append to existing .env.example if variables don't already exist
      envContent = existingEnvFile.content
      envVars.forEach((envVar) => {
        const varName = envVar.split('=')[0].split('\n').pop()
        if (varName && !envContent.includes(varName)) {
          envContent += `\n${envVar}\n`
        }
      })
      existingEnvFile.content = envContent
    } else {
      // Create new .env.example file
      const envFile: GeneratedFile = {
        name: '.env',
        fileType: 'example',
        content: newEnvContent,
        contentEncoding: 'utf8',
      }

      rootFolder.files.push(envFile)
    }

    return structure
  }
}
