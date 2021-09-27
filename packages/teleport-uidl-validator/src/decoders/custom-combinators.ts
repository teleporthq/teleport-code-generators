/* tslint:disable member-ordering */
import { Result, DecoderError } from '@mojotech/json-type-validation'

/* These are some custom combinators that comes in handy for us,
instead of parsing and cross-checking regex again. The combinators,
can used inside a existing Decoder, since we did not implement any run()
runWithException() etc */

type DecodeResult<A> = Result.Result<A, Partial<DecoderError>>
export class CustomCombinators<A> {
  // @ts-ignore
  private constructor(private decode: (json: string) => DecodeResult<A>) {}

  static isValidComponentName(): CustomCombinators<string> {
    return new CustomCombinators<string>((json: string) => {
      const componentNameRegex = new RegExp('^[A-Z]+[a-zA-Z0-9]*$')
      if (json && typeof json === 'string' && componentNameRegex.test(json)) {
        return Result.ok(json)
      } else if (json.length === 0) {
        throw new Error(`Component Name cannot be empty`)
      }
      throw new Error(`Invalid Component name, got ${json}`)
    })
  }

  static isValidNavLink(): CustomCombinators<string> {
    return new CustomCombinators<string>((json: string) => {
      const navLinkRegex = new RegExp('/[a-zA-Z0-9-_]*$')
      if (json && typeof json === 'string' && navLinkRegex.test(json)) {
        return Result.ok(json)
      }
      throw new Error(`Invalid link attribute, received ${json}`)
    })
  }

  static isValidFileName(): CustomCombinators<string> {
    return new CustomCombinators<string>((json: string) => {
      const fileNameRegex = new RegExp('^[a-zA-Z0-9-_.]*$')
      if (json && typeof json === 'string' && fileNameRegex.test(json)) {
        return Result.ok(json)
      } else if (json.length === 0) {
        throw new Error(`File Name cannot be empty`)
      }
      throw new Error(`Invalid File name, received ${json}`)
    })
  }

  static isValidElementName(): CustomCombinators<string> {
    return new CustomCombinators<string>((json: string) => {
      const fileNameRegex = new RegExp('^[a-zA-Z]+[a-zA-Z0-9-_]*$')
      if (json && typeof json === 'string' && fileNameRegex.test(json)) {
        return Result.ok(json)
      } else if (json.length === 0) {
        throw new Error(`Name attribute cannot be empty`)
      }
      throw new Error(`Invalid name attribute, received ${json}`)
    })
  }
}
