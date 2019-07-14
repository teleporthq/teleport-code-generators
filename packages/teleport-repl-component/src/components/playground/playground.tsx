import { Component, h, Prop } from '@stencil/core'

@Component({
  tag: 'simple-component',
})
export class SimpleComponent {
  @Prop()
  public title: string = 'Hello'

  public render() {
    return (
      <div>
        <span>
          {this.title}
          World!
        </span>
      </div>
    )
  }
}
