import {
  ProjectPlugin,
  ProjectPluginStructure,
  ProjectUIDL,
  UIDLScriptAsset,
  UIDLStaticValue,
  UIDLENVValue,
} from '@teleporthq/teleport-types'

/**
 * This plugin injects the captcha provider script into the _document.js file.
 * It adds the script to the globals.assets array as a proper script asset.
 * For reCAPTCHA, it includes the site key as a URL parameter using an inline script
 * to dynamically load the library with the environment variable.
 */
export class NextFormsCaptchaScriptPlugin implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    const { uidl } = structure

    // Skip if no forms are defined
    if (!uidl.forms || !uidl.forms.items || Object.keys(uidl.forms.items).length === 0) {
      return structure
    }

    // Check if any form has captcha enabled and get the captcha key
    let captchaKey = null
    let hasFormSpecificCaptcha = false

    Object.values(uidl.forms.items).forEach((form) => {
      if (form.security?.captchaPublicKey) {
        captchaKey = form.security.captchaPublicKey
        hasFormSpecificCaptcha = true
      }
    })

    // If no form-specific captcha, use the global default
    let usingDefaultCaptcha = false
    if (!hasFormSpecificCaptcha && uidl.forms.globalConfig?.defaultCaptchaPublicKey) {
      captchaKey = uidl.forms.globalConfig.defaultCaptchaPublicKey
      usingDefaultCaptcha = true
    }

    if (!captchaKey) {
      return structure
    }

    // Get the captcha provider (default to recaptcha)
    const captchaProvider = uidl.forms.globalConfig?.captchaProvider || 'recaptcha'

    // Add to globals.assets
    if (!uidl.globals.assets) {
      uidl.globals.assets = []
    }

    switch (captchaProvider) {
      case 'hcaptcha':
        this.addHCaptchaScript(uidl)
        break
      case 'turnstile':
        this.addTurnstileScript(uidl)
        break
      case 'recaptcha':
      default:
        this.addRecaptchaScript(uidl, captchaKey, usingDefaultCaptcha)
        break
    }

    return structure
  }

  async runAfter(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    return structure
  }

  private addRecaptchaScript(
    uidl: ProjectUIDL,
    captchaKey: UIDLStaticValue | UIDLENVValue,
    usingDefaultCaptcha: boolean
  ): void {
    // Use enterprise API if using the default captcha key
    const baseUrl = usingDefaultCaptcha
      ? 'https://www.google.com/recaptcha/enterprise.js'
      : 'https://www.google.com/recaptcha/api.js'

    if (captchaKey.type === 'static') {
      // For static keys, add directly to the URL
      const scriptPath = `${baseUrl}?render=${captchaKey.content}`
      const scriptAsset: UIDLScriptAsset = {
        type: 'script',
        path: scriptPath,
        options: {
          async: true,
          defer: true,
        },
      }
      uidl.globals.assets.push(scriptAsset)
    } else {
      // For env variables, use template literal interpolation
      const envVarName = captchaKey.content
      const scriptPath = `${baseUrl}?render=\${process.env.${envVarName}}`
      const scriptAsset: UIDLScriptAsset = {
        type: 'script',
        path: scriptPath,
        options: {
          async: true,
          defer: true,
        },
      }
      uidl.globals.assets.push(scriptAsset)
    }
  }

  private addHCaptchaScript(uidl: ProjectUIDL): void {
    const scriptAsset: UIDLScriptAsset = {
      type: 'script',
      path: 'https://js.hcaptcha.com/1/api.js',
      options: {
        async: true,
        defer: true,
      },
    }
    uidl.globals.assets.push(scriptAsset)
  }

  private addTurnstileScript(uidl: ProjectUIDL): void {
    const scriptAsset: UIDLScriptAsset = {
      type: 'script',
      path: 'https://challenges.cloudflare.com/turnstile/v0/api.js',
      options: {
        async: true,
        defer: true,
      },
    }
    uidl.globals.assets.push(scriptAsset)
  }
}
