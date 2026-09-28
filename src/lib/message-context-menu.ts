/** Copy-only adaptation of OpenClaw 2026.9.5 chat-thread-interactions.ts.
 * Native popover owns dismissal and lifetime; rewind is a separate session-tree
 * action because PI does not assign every rendered message block its own node. */
export function usesNativeMessageContextMenu(path: EventTarget[]): boolean {
  return path.some((target) => target instanceof Element && (
    target.matches("a,img,audio,video,iframe,input,textarea,select")
    || target instanceof HTMLElement && target.isContentEditable
  ));
}

export function messageContextMenuPosition(x: number, y: number, width: number, height: number, viewportWidth: number, viewportHeight: number) {
  return {
    left: Math.max(0, Math.min(x, viewportWidth - width - 8)),
    top: Math.max(0, Math.min(y, viewportHeight - height - 8)),
  };
}

export function openMessageContextMenu(
  event: MouseEvent | KeyboardEvent,
  text: string,
  copy: (text: string) => Promise<boolean>,
) {
  if (event.defaultPrevented || !text || usesNativeMessageContextMenu(event.composedPath())) return;
  const bubble = event.currentTarget;
  if (!(bubble instanceof HTMLElement) || bubble.classList.contains("streaming")) return;
  const keyboard = event instanceof KeyboardEvent;
  if (keyboard && event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return;
  event.preventDefault();
  event.stopPropagation();
  document.querySelectorAll(".chat-reply-context-menu").forEach((menu) => menu.remove());
  const menu = document.createElement("div");
  menu.className = "chat-reply-context-menu";
  menu.popover = "auto";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Message actions");
  const appendCopy = (label: string, value: string) => {
    if (!value) return;
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    const content = document.createElement("span");
    content.dataset.copyLabel = "";
    content.textContent = label;
    button.append(content);
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      let copied = false;
      try { copied = await copy(value); } catch { /* Keep the action available for retry. */ }
      if (!button.isConnected) return;
      button.disabled = false;
      button.removeAttribute("aria-busy");
      if (copied) menu.hidePopover();
      else content.textContent = "Copy failed — retry";
    });
    menu.append(button);
  };
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed && Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i)).some((range) => range.intersectsNode(bubble))) {
    appendCopy("Copy selection", selection.toString());
  }
  const target = event.target instanceof Element ? event.target : null;
  const code = target?.closest("pre,code");
  if (code && bubble.contains(code)) appendCopy("Copy code", code.textContent ?? "");
  appendCopy("Copy as markdown", text);
  // Keep the transient menu in its message owner so navigation removes it too.
  bubble.append(menu);
  menu.showPopover();
  const origin = bubble.getBoundingClientRect();
  const x = keyboard ? origin.left : event.clientX;
  const y = keyboard ? origin.top : event.clientY;
  const rect = menu.getBoundingClientRect();
  const position = messageContextMenuPosition(x, y, rect.width, rect.height, innerWidth, innerHeight);
  menu.style.left = `${position.left}px`;
  menu.style.top = `${position.top}px`;
  const buttons = [...menu.querySelectorAll("button")];
  menu.addEventListener("keydown", (keyEvent) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(keyEvent.key)) return;
    keyEvent.preventDefault();
    keyEvent.stopPropagation();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = keyEvent.key === "Home" ? 0 : keyEvent.key === "End" ? buttons.length - 1
      : (index + (keyEvent.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  });
  menu.addEventListener("toggle", () => {
    if (!menu.matches(":popover-open")) menu.remove();
  });
  buttons[0]?.focus();
}
