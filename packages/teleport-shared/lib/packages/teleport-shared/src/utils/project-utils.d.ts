import {
  GeneratedFile,
  PackageJSON,
  ComponentFactoryParams,
  ComponentGeneratorOutput,
  GeneratedFolder,
} from '../../../../src/typings/generators'
import { ProjectUIDL } from '../../../../src/typings/uidl-definitions'
interface HtmlIndexFileOptions {
  assetsPrefix?: string
  fileName?: string
  appRootOverride?: string
}
export declare const createHtmlIndexFile: (
  uidl: ProjectUIDL,
  options: HtmlIndexFileOptions
) => GeneratedFile
export declare const createManifestJSONFile: (
  uidl: ProjectUIDL,
  assetsPrefix?: string
) => GeneratedFile
export declare const createPackageJSONFile: (
  packageJSONTemplate: PackageJSON,
  overwrites: {
    dependencies: Record<string, string>
    projectName: string
  }
) => GeneratedFile
export declare const createPageOutputs: (
  params: ComponentFactoryParams
) => Promise<ComponentGeneratorOutput>
export declare const createComponentOutputs: (
  params: ComponentFactoryParams
) => Promise<ComponentGeneratorOutput>
export declare const joinGeneratorOutputs: (
  generatorOutputs: ComponentGeneratorOutput[]
) => ComponentGeneratorOutput
export declare const createFile: (name: string, fileType: string, content: string) => GeneratedFile
export declare const createFolder: (
  name: string,
  files?: GeneratedFile[],
  subFolders?: GeneratedFolder[]
) => GeneratedFolder
export {}
