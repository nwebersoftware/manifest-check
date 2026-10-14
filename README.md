# manifest-check

**Audit an Android manifest before Play does.** Reads the manifest straight out of an **`.aab`**
(protobuf) — or a plain-text `AndroidManifest.xml` — and flags the things that get builds rejected or
quietly expose your app.

```bash
npx @njweber/android-manifest-check ./app-release.aab
npx @njweber/android-manifest-check ./android/app/src/main/AndroidManifest.xml
```

```
manifest-check — Android manifest audit
artifact: ./app-release.aab

✓ manifest  <manifest> parsed — com.example.app
✓ debuggable  not debuggable
✓ cleartext  no blanket cleartext traffic
! allowBackup  allowBackup="true" — app data can be extracted via adb backup (consider false)
! activity:.LegacyActivity:exported  is exported with no <intent-filter> — make sure that is intended
✓ targetSdkVersion  targetSdkVersion 36
✓ permissions  15 permission(s) declared, 7 sensitive — each needs a Play data-safety declaration
```

## What it checks

| Check | Severity |
|---|---|
| `android:debuggable="true"` in a release build | **fail** |
| component with `<intent-filter>` but no `android:exported` (required since API 31) | **fail** |
| `usesCleartextTraffic="true"` (plain HTTP permitted) | warn |
| `allowBackup="true"` (data extractable via adb) | warn |
| app-owned component `exported` with no `<intent-filter>` | warn |
| `targetSdkVersion` below the level Play currently requires | warn |
| sensitive permissions (each needs a Play data-safety declaration) | info |

Library components (`androidx.*`, etc.) are ignored for the exported-without-filter warning, so you
only hear about **your own** code.

## Why it's dependency-free

It ships its own **protobuf** wire-format reader for the AAB manifest and a small XML reader for text
manifests — no Android SDK, no `aapt2`, no Java. Runs anywhere Node runs.

## Limits

- **`.apk` binary-XML manifests aren't supported yet** — pass the `.aab`, or the merged/source
  `AndroidManifest.xml` (both `android/app/src/main/` and `app/build/intermediates/merged_manifests/…` work).
- Manifest-derived checks only: `targetSdkVersion` and friends are reported from the manifest, not `build.gradle`.

## Exit codes

`0` clean · `1` blocking issue(s) · `2` bad input.

## Family

`app-check` · `store-check` · `ipa-check` · `privacy-check` · `icon-check`

## License

MIT.
