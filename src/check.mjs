import { parseManifest, manifestFromAab } from './manifest.mjs';

const COMPONENTS = ['activity', 'service', 'receiver', 'provider'];

const SENSITIVE_PERMISSIONS = new Set([
  'android.permission.CAMERA',
  'android.permission.RECORD_AUDIO',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_BACKGROUND_LOCATION',
  'android.permission.READ_CONTACTS',
  'android.permission.WRITE_CONTACTS',
  'android.permission.READ_CALENDAR',
  'android.permission.READ_SMS',
  'android.permission.READ_CALL_LOG',
  'android.permission.READ_PHONE_STATE',
  'android.permission.BODY_SENSORS',
  'android.permission.ACTIVITY_RECOGNITION',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.READ_MEDIA_VIDEO',
  'android.permission.BLUETOOTH_SCAN',
  'android.permission.BLUETOOTH_CONNECT',
  'android.permission.POST_NOTIFICATIONS',
]);

function finish(checks) {
  const failed = checks.filter((c) => c.severity === 'fail' && !c.ok);
  const warned = checks.filter((c) => c.severity === 'warn' && !c.ok);
  return { ok: failed.length === 0, checks, failed, warned };
}

const child = (el, name) => (el.children ?? []).find((c) => c.name === name);
const children = (el, name) => (el.children ?? []).filter((c) => c.name === name);

/** Load a manifest from any supported input buffer. */
export function loadManifest(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const head = b.subarray(0, 4).toString('latin1');
  if (head.startsWith('PK')) return parseManifest(manifestFromAab(b));
  return parseManifest(b);
}

export function checkManifest(buf) {
  const checks = [];
  const add = (id, severity, ok, detail) => checks.push({ id, severity, ok, detail });

  let root;
  try {
    root = loadManifest(buf);
  } catch (e) {
    add('manifest', 'fail', false, e.message);
    return finish(checks);
  }
  if (!root || root.name !== 'manifest') {
    add('manifest', 'fail', false, 'root element is not <manifest> — is this an Android manifest?');
    return finish(checks);
  }

  add('manifest', 'fail', true, `<manifest> parsed${root.attrs.package ? ` — ${root.attrs.package}` : ''}`);

  const app = child(root, 'application');
  if (!app) {
    add('application', 'warn', false, 'no <application> element found');
  } else {
    const dbg = app.attrs.debuggable;
    add(
      'debuggable',
      'fail',
      dbg !== 'true',
      dbg === 'true'
        ? 'android:debuggable="true" — a release build must not be debuggable'
        : 'not debuggable',
    );

    const cleartext = app.attrs.usesCleartextTraffic;
    add(
      'cleartext',
      'warn',
      cleartext !== 'true',
      cleartext === 'true'
        ? 'usesCleartextTraffic="true" — plain-HTTP traffic is permitted (Play flags sensitive data over HTTP)'
        : 'no blanket cleartext traffic',
    );

    const backup = app.attrs.allowBackup;
    add(
      'allowBackup',
      'warn',
      backup !== 'true',
      backup === 'true'
        ? 'allowBackup="true" — app data can be extracted via adb backup (consider false)'
        : 'allowBackup not enabled',
    );
  }

  const host = app ?? root;
  const pkg = root.attrs.package ?? '';
  const isAppOwned = (n) => typeof n === 'string' && (n.startsWith('.') || Boolean(pkg) && n.startsWith(pkg));
  for (const tag of COMPONENTS) {
    for (const el of children(host, tag)) {
      const name = el.attrs.name ?? '(unnamed)';
      const hasFilter = Boolean(child(el, 'intent-filter'));
      if (hasFilter && el.attrs.exported === undefined) {
        add(
          `${tag}:${name}`,
          'fail',
          false,
          `<${tag} android:name="${name}"> has an <intent-filter> but no android:exported — required since Android 12 (API 31)`,
        );
      } else if (el.attrs.exported === 'true' && !hasFilter && isAppOwned(el.attrs.name)) {
        add(
          `${tag}:${name}:exported`,
          'warn',
          false,
          `<${tag} android:name="${name}"> is exported with no <intent-filter> — make sure that is intended`,
        );
      }
    }
  }

  const sdk = child(root, 'uses-sdk');
  const target = sdk ? Number(sdk.attrs.targetSdkVersion) : NaN;
  if (Number.isFinite(target)) {
    add(
      'targetSdkVersion',
      'warn',
      target >= 35,
      target >= 35
        ? `targetSdkVersion ${target}`
        : `targetSdkVersion ${target} — may be below the API level Google Play currently requires`,
    );
  }

  const perms = children(root, 'uses-permission')
    .map((p) => p.attrs.name)
    .filter(Boolean);
  if (perms.length) {
    const sensitive = perms.filter((p) => SENSITIVE_PERMISSIONS.has(p));
    add(
      'permissions',
      'warn',
      true,
      `${perms.length} permission(s) declared${sensitive.length ? `, ${sensitive.length} sensitive — each needs a Play data-safety declaration` : ''}`,
    );
  }

  return finish(checks);
}

export function formatReport(report, label = '') {
  const out = ['manifest-check — Android manifest audit'];
  if (label) out.push(`artifact: ${label}`);
  out.push('');
  for (const c of report.checks) {
    out.push(`${c.ok ? '✓' : c.severity === 'fail' ? '✗' : '!'} ${c.id}  ${c.detail}`);
  }
  out.push('');
  if (report.ok) out.push(report.warned.length ? `PASS (${report.warned.length} warning${report.warned.length > 1 ? 's' : ''})` : 'PASS — no issues found.');
  else out.push(`FAIL — ${report.failed.length} blocking issue${report.failed.length > 1 ? 's' : ''}.`);
  return out.join('\n');
}
