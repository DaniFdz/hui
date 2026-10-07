/**
 * Base class for HUI's own Lit components. It renders into the light DOM so the app stylesheets apply directly, the
 * same arrangement OpenClaw's Control UI uses for its shell and layout components. Use LitElement directly for
 * anything that needs style encapsulation.
 */
import { LitElement } from "lit";

export abstract class HuiElement extends LitElement {
  override createRenderRoot() {
    return this;
  }
}
