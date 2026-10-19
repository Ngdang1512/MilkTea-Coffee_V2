export class BaseView {
  constructor(root) {
    this.root = root;
  }

  mount(markup) {
    this.root.innerHTML = markup;
  }
}
