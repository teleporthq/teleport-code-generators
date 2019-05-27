import prettyHTML from '../src/index'

describe('Testing rehype formatter for HTML', () => {
  it('Should format the html input', async () => {
    const input = {
      html: `
      <!doctype html>
<html lang="en"><meta charset="utf-8"><title>ARIA</title>
<form>
<fieldset><legend>Login</legend>
<div>
<label for="username">Username</label>
<input id="username" aria-describedby="username-tip" required>
<div role="tooltip" id="username-tip">Your username is your email address</div>
</div>
<div>
<label for="password">Password</label>
<input id="password" aria-describedby="password-tip" required>
<div role="tooltip" id="password-tip">Was emailed to you when you signed up</div>
</div>
</fieldset>
</form>`,
      css: '',
      js: '',
    }
    const result = await prettyHTML(input)
    expect(result).toBeTruthy()
  })
})
