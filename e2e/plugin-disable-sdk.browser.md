# Plugin disable policy — Browser E2E

Validated on 2026-09-24 against the real HUI development server and PI SDK runtime.

## Fixture

- HUI URL: `http://localhost:5173`
- Isolated PI agent directory with one configured package and one direct extension
- Package command: `/fixture-plugin`
- Direct-extension command: `/direct-fixture`

## Journey and result

1. Opened **Settings → Plugins** and confirmed both configured resources were shown as enabled.
2. Disabled the package from its switch.
3. Reloaded the page and confirmed the disabled state persisted in HUI settings.
4. Started a new PI SDK session from the New Session flow.
5. Opened the slash-command browser: `/direct-fixture` was available and `/fixture-plugin` was absent.
6. Repeated the responsive check at desktop and mobile widths.

The Browser error log contained no page errors. The runtime integration test additionally verifies that disabled package and direct-extension top-level modules are never imported and that PI's settings file remains byte-for-byte unchanged.

## Responsive alignment follow-up

After the initial review, the mobile action cluster was tightened so the switch
and optional removal button stay together at the trailing edge of each plugin
row. A follow-up fixed the Web Awesome switch's internal 44 px touch target: its
visible 18 px track and the adjacent 44 px button now share the same measured
vertical center. The direct-extension switch was exercised off and back on
through the real rendered control; the persisted state followed both changes and
Browser reported no page errors. Desktop alignment remained unchanged.

- Aligned desktop controls
- Aligned mobile controls

## Capability route follow-up

The primary-sidebar `/plugins` link was exercised from a rendered
session and from Home. Both update the internal view to `surface`, select the
`plugins` capability and replace the chat with the Plugins page. A separate
HMR-equivalent check passes a cloned page descriptor from an older module;
routing now resolves it by its stable capability id instead of object identity.
Browser reported no page errors.

- Capability route on desktop
- Capability route on mobile
