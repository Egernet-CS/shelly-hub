// Tiny element builder: h("button", { class: "x", onclick: fn }, "text", child).
// Strings become text nodes, so user-provided names are never parsed as HTML.
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key === "class") el.className = value;
    else if (key in el && key !== "list") el[key] = value;
    else el.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

// A button that asks "Sure?" on the first click and runs the action on the second.
export function confirmButton(label, confirmLabel, action) {
  let armed = null;
  const button = h("button", {
    type: "button",
    class: "btn btn-danger",
    onclick: () => {
      if (!armed) {
        button.textContent = confirmLabel;
        armed = setTimeout(() => {
          armed = null;
          button.textContent = label;
        }, 3000);
        return;
      }
      clearTimeout(armed);
      armed = null;
      action();
    },
  }, label);
  return button;
}
