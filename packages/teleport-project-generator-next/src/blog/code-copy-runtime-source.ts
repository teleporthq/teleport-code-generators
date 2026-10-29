/**
 * The class of the Copy button the post transform writes into every code
 * block (`teleport-plugin-next-data-source/src/transformations/code-copy.ts`);
 * paired with the GUI's `CODE_COPY_BUTTON_CLASS` in
 * `features/blog/utils/post-body-styles.ts`, which styles it.
 */
export const CODE_COPY_BUTTON_CLASS = 'tq-code-copy'

/**
 * The one script a content site ships for its code blocks: a click on a Copy
 * button puts the block's code on the clipboard and shows "Copied" for a
 * moment (`data-copied="true"`, which the block's rules can colour). The code
 * is the `pre`'s text without the button's own label; a trailing line break
 * is left out, so a pasted block ends where the code does.
 *
 * One listener on the document, so it serves every block the page renders,
 * those a later navigation renders included. Older browsers without the
 * clipboard API copy through a hidden text area.
 */
export const CODE_COPY_RUNTIME_SOURCE = `(function () {
  if (typeof document === 'undefined') return;
  var CLASS = '${CODE_COPY_BUTTON_CLASS}';
  var LABEL_TIME_MS = 1600;
  function blockOf(button) {
    var node = button.parentNode;
    while (node && String(node.tagName).toLowerCase() !== 'pre') node = node.parentNode;
    return node;
  }
  function codeOf(pre) {
    var copy = pre.cloneNode(true);
    var buttons = copy.querySelectorAll('.' + CLASS);
    for (var i = 0; i < buttons.length; i++) buttons[i].parentNode.removeChild(buttons[i]);
    return (copy.textContent || '').replace(/\\n$/, '');
  }
  function write(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.top = '-1000px';
      document.body.appendChild(area);
      area.select();
      var done = false;
      try { done = document.execCommand('copy'); } catch (error) { done = false; }
      document.body.removeChild(area);
      done ? resolve() : reject(new Error('copy refused'));
    });
  }
  function showCopied(button) {
    button.setAttribute('data-copied', 'true');
    button.textContent = button.getAttribute('data-copied-label') || 'Copied';
    clearTimeout(button.__tqCopyTimer);
    button.__tqCopyTimer = setTimeout(function () {
      button.removeAttribute('data-copied');
      button.textContent = button.getAttribute('data-copy-label') || 'Copy';
    }, LABEL_TIME_MS);
  }
  document.addEventListener('click', function (event) {
    var target = event.target;
    var button = target && target.closest ? target.closest('.' + CLASS) : null;
    if (!button) return;
    var pre = blockOf(button);
    if (!pre) return;
    event.preventDefault();
    write(codeOf(pre)).then(function () { showCopied(button); }, function () {});
  });
})();`
