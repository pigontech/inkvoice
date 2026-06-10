// App version — single source of truth is the frontend package.json, inlined at
// build time. The relative import resolves to the OSS frontend package.json in
// both the OSS standalone build and a downstream overlay build (which composes this
// same file), so no per-build wiring is needed.
import { version } from "../../package.json";

export const APP_VERSION = version;
