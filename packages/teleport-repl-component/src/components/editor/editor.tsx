import { Component, h, Prop, State } from '@stencil/core'
import CodeFlask from 'codeflask'

import { createReactComponentGenerator } from '@teleporthq/teleport-component-generator-react'
import { createVueComponentGenerator } from '@teleporthq/teleport-component-generator-vue'
import Prism from 'prismjs'
import 'prismjs/components/prism-jsx'

@Component({
  tag: 'teleport-uidl-repl',
  styleUrl: 'editor.css',
  shadow: false,
})
export class Editor {
  @Prop() public uidl: string
  @Prop() public dark: boolean = false
  @State() public selectedCSSFlavour: string
  @State() public selectedFramework: 'vue' | 'react' = 'react'
  @State() public showCssFile: boolean = false
  private jsonEditor: any
  private javascriptEditor: any
  private cssEditor: any

  public componentDidLoad() {
    this.setupEditor()
  }

  public render() {
    return (
      <div class="repl-wrapper" data-theme={this.dark ? 'dark' : ''}>
        <div class="repl-options">
          <div class="repl-options-right">
            <div class="repl-options-framework">
              <div>
                <input
                  type="radio"
                  id="react"
                  name="framework"
                  value="react"
                  checked
                  onInput={(event) => this.handleChange(event)}
                />
                <label htmlFor="react">React</label>
              </div>
              <div>
                <input
                  type="radio"
                  id="vue"
                  name="framework"
                  value="vue"
                  onInput={(event) => this.handleChange(event)}
                />
                <label htmlFor="vue">Vue</label>
              </div>
            </div>
            {this.selectedFramework === 'react' ? (
              <select onInput={(event) => this.handleSelect(event)}>
                <option value="InlineStyles">InlineStyles</option>
                <option value="JSS">JSS</option>
                <option value="StyledJSX">StyledJSX</option>
                <option value="CSSModules">CSSModules</option>
                <option value="StyledComponents">StyledComponents</option>
              </select>
            ) : (
              ''
            )}
          </div>
        </div>
        <div class="editor-wrapper">
          <div id="jsonEditor">{this.uidl}</div>
          <div>
            <div id="javascriptEditor" class="javascript-editor">
              {this.generateComponent}
            </div>
            <div class={this.showCssFile ? 'show-css-tab' : 'hide-css-tab'} id="css-tab">
              <div class="css-tab-header" onClick={() => (this.showCssFile = !this.showCssFile)} />
              <div id="cssEditor" />
            </div>
          </div>
        </div>
      </div>
    )
  }
  private setupEditor() {
    this.jsonEditor = new CodeFlask('#jsonEditor', {
      language: 'js',
      lineNumbers: true,
    })
    this.javascriptEditor = new CodeFlask('#javascriptEditor', {
      language: 'jsx',
      readonly: true,
    })
    this.javascriptEditor.addLanguage('jsx', Prism.languages.jsx)
    this.jsonEditor.onUpdate(() => {
      this.generateComponent()
    })
    this.cssEditor = new CodeFlask('#cssEditor', {
      language: 'css',
      readonly: true,
    })
    this.cssEditor.addLanguage('css', Prism.languages.css)
  }

  private async generateComponent() {
    let generator = createReactComponentGenerator(this.selectedCSSFlavour)
    if (this.selectedFramework === 'vue') {
      generator = createVueComponentGenerator()
    }
    if (JSON.parse(this.jsonEditor.getCode())) {
      const uidl = JSON.parse(this.jsonEditor.getCode())
      const result = await generator.generateComponent(uidl)
      this.javascriptEditor.updateCode(result.files[0].content.trim())
      if (result.files[1]) {
        this.showCssFile = true
        this.cssEditor.updateCode(result.files[1].content.trim())
      }
    }
  }

  private handleChange(event) {
    this.selectedFramework = event.target.value
    this.generateComponent()
    this.cssEditor.updateCode('')
  }

  private handleSelect(event) {
    this.selectedCSSFlavour = event.target.value
    this.generateComponent()
    this.cssEditor.updateCode('')
  }
}
