// Bootstrap registration hook for the open-core overlay system.
//
// `main.tsx` side-effect-imports `@/registrations` before rendering, giving an
// overlay a single entry point to register its routes, nav items, slots,
// settings tabs, i18n, and plugins at import time (before the first render).
//
// OSS ships this as an empty no-op stub. A downstream overlay overrides this
// module via the `@/` overlay resolver (its own `registrations.tsx`), wiring
// up its registration modules and the plugin framework. Self-hosted OSS
// keeps the no-op below.
export {};
