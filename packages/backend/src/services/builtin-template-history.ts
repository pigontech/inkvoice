/**
 * Every HTML version of each built-in template that this repository ever
 * bundled, by template name, as hashTemplateHtml() hashes them. The boot sync
 * (seedBuiltinTemplates) treats a built-in whose HTML matches one of these as
 * unedited, so it can move it to the HTML the running release bundles.
 *
 * Computed once on 2026-11-06 from all 524 commits on every branch, tag and
 * pull request, old-full-history included. Each commit was read through its own
 * BUILTIN_TEMPLATES mapping (in services/builtin-templates.ts, or in
 * database/seed.ts before that file existed), and each file was decoded as
 * UTF-8 the way readTemplateFile() reads it. The dates are when each version
 * was first committed.
 *
 * Frozen: do not regenerate or extend it. Every boot records the versions it
 * bundles in builtin_template_versions, which covers all later releases.
 */
export const BUNDLED_TEMPLATE_HISTORY: Readonly<Record<string, readonly string[]>> = {
  Inkvoice: [
    "0ab468cea2a02b5678cd35284d2d2726770f4015d31672d2413a0a25d8377379", // 2026-04-07
    "b8fda41c9311162d157e9574b1e5b6fd78ee68bd1f5e3c5433d3d7e6ba752731", // 2026-05-04
    "ce96c5f285ae1d8e38f4c153d6237577e2177f304e7d9b813c8df876c56ed31d", // 2026-06-18
    "0fabef386a5f46a231af91f186d00435a21c5aeec7bcb640a6d5013d76be938c", // 2026-08-03
    "fd6700a9143cb16e078f1c01f1ec5a780fb4d3874a7e59b061b64af953f85162", // 2026-08-03
    "0c7f85c77bc5890dce4cc5120b930ca981d684b2c4c3f406f7196653b85b32bc", // 2026-08-03
    "e83867e9b0a48b504824059f433adb7e94eb23bc64b8793f8b371aa4781d146a", // 2026-08-30
  ],
  Editorial: [
    "b52b6945d24df69e709af181f5a95828e53f2ea31e772ff6b166ce4bf9c9f85c", // 2026-04-07
    "a80ff16b96189ba8ae98c0406be19e98daffa695c0c9665a4c7ddb384bc0fcd3", // 2026-08-03
    "03fbc2d1449ec3ee79d2979958559e161f4d9ba9578b48407406a975c2e2a22b", // 2026-08-03
    "e558050042984959ea0f2cfc68a2bf177acfedf2412b4a525f9623d9c38136f0", // 2026-08-03
    "fd92271189d6937de43564d7e7e3b1c2770c48b2e4498f913e4b71b85b57f2d8", // 2026-08-30
    "0a9a63d2e3632bd127ee9d336a3d7ccd962f621ef00ebf9634a5bfc28d5efd96", // 2026-09-10
  ],
  Swiss: [
    "4ce23ae993ab8c91076f4bdde95fade29b7b754c56f57444f79a78b9b805c869", // 2026-04-07
    "3f69e487397f70a442a5696860ba6d87fa07346fe7a587018fe899556a22a575", // 2026-08-03
    "81725dfdddf7199741141d6b6af0552f9c0a7a3767d2dc1a6ac4150b901880c3", // 2026-08-03
    "effead58a39336eb9d236aff3bc6e4d5aeda2bcf45f52fda4d97516c481232b8", // 2026-08-03
    "f1abdd8d78312ba5fa20beb8c008a93c6261b947a1aa5ba5439df5f9aa816d49", // 2026-08-30
    "c7d5cbbf7d833191480eaa415bbd082c51f2e0d586464eff3fa6fb3362b5fa90", // 2026-09-10
  ],
  Minimal: [
    "a7c41293224534ef83783547518713ddce5e96b2872853028c8252699b40e371", // 2026-05-04
    "e93aa21fee02454b1330272a2bb466c9c583f17069b6c42491c621aee85fe3b5", // 2026-08-03
    "64c980854e359f17cd9b63839d8feb2192a4e8fcef62e174ee73873eb69430de", // 2026-08-03
    "1bd22b71043589d3b84e53dae63f6202fbdbc1bb3ff51263a9e97b4a6f193495", // 2026-08-03
    "f4d7729a3ea26397721126476c37d61b38afa7f607d4c0668e22e3f785789c25", // 2026-08-30
  ],
  "DIN 5008": [
    "a444c00d823aecd833321e0a29ee3ac206790bce3c2848f250ecaad4515bf696", // 2026-09-05
    "fd394b4ab57c9b9340169cbcc355b025b19479ed676189032908803b8b22c328", // 2026-11-01
  ],
};
