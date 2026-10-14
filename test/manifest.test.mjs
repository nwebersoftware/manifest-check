import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkManifest, loadManifest } from '../src/check.mjs';
import { parseTextManifest } from '../src/manifest.mjs';

/* --------------------------- protobuf fixture encoder --------------------------- */

function vint(n) {
  const out = [];
  do {
    let b = n & 0x7f;
    n = Math.floor(n / 128);
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return Buffer.from(out);
}
const tag = (f, w) => vint(f * 8 + w);
const ld = (f, b) => Buffer.concat([tag(f, 2), vint(b.length), b]);
const str = (f, s) => ld(f, Buffer.from(s, 'utf8'));

const attr = (name, value) => ld(4, Buffer.concat([str(2, name), str(3, value)]));
const el = (name, attrs = [], children = []) =>
  Buffer.concat([ld(3, Buffer.from(name, 'utf8')), ...attrs, ...children.map((c) => ld(5, node(c)))]);
const node = (elementBuf) => ld(1, elementBuf); // XmlNode { element = 1 }

function pbManifest({ appAttrs = [], activityAttrs = [], withFilter = false } = {}) {
  const activity = el('activity', [attr('name', '.MainActivity'), ...activityAttrs], withFilter ? [el('intent-filter')] : []);
  const application = el('application', appAttrs, [activity]);
  const manifest = el('manifest', [attr('package', 'com.example.demo')], [application]);
  return node(manifest);
}

/* ------------------------------------ tests ------------------------------------ */

test('parses a text manifest into a tree', () => {
  const root = parseTextManifest('<manifest package="com.a.b"><application android:name=".A"/></manifest>');
  assert.equal(root.name, 'manifest');
  assert.equal(root.attrs.package, 'com.a.b');
  assert.equal(root.children[0].name, 'application');
  assert.equal(root.children[0].attrs.name, '.A');
});

test('clean text manifest passes', () => {
  const report = checkManifest(
    '<manifest package="com.a.b"><uses-sdk android:targetSdkVersion="36"/><application><activity android:name=".Main" android:exported="true"><intent-filter/></activity></application></manifest>',
  );
  assert.equal(report.ok, true);
});

test('flags debuggable + missing exported', () => {
  const report = checkManifest(
    '<manifest package="com.a.b"><application android:debuggable="true"><activity android:name=".Main"><intent-filter/></activity></application></manifest>',
  );
  assert.equal(report.ok, false);
  assert.ok(report.failed.some((c) => c.id === 'debuggable'));
  assert.ok(report.failed.some((c) => c.id === 'activity:.Main'));
  assert.equal(report.failed.length, 2);
});

test('warns on cleartext and allowBackup', () => {
  const report = checkManifest(
    '<manifest package="com.a.b"><application android:usesCleartextTraffic="true" android:allowBackup="true"/></manifest>',
  );
  assert.equal(report.ok, true);
  assert.ok(report.warned.some((c) => c.id === 'cleartext'));
  assert.ok(report.warned.some((c) => c.id === 'allowBackup'));
});

test('warns on a low targetSdkVersion', () => {
  const report = checkManifest('<manifest package="com.a.b"><uses-sdk android:targetSdkVersion="28"/><application/></manifest>');
  assert.ok(report.warned.some((c) => c.id === 'targetSdkVersion'));
});

test('only warns about app-owned exported components (no library noise)', () => {
  const report = checkManifest(
    '<manifest package="com.a.b"><application><service android:name="androidx.work.SystemJobService" android:exported="true"/><service android:name=".Mine" android:exported="true"/></application></manifest>',
  );
  const ids = report.warned.map((c) => c.id);
  assert.ok(ids.includes('service:.Mine:exported'));
  assert.ok(!ids.some((id) => id.includes('androidx')));
});

/* ------------------------ protobuf (AAB) path, same checks ----------------------- */

test('parses a protobuf manifest (AAB shape)', () => {
  const root = loadManifest(pbManifest());
  assert.equal(root.name, 'manifest');
  assert.equal(root.attrs.package, 'com.example.demo');
});

test('protobuf manifest: debuggable + missing exported fail', () => {
  const report = checkManifest(pbManifest({ appAttrs: [attr('debuggable', 'true')], withFilter: true }));
  assert.equal(report.ok, false);
  assert.ok(report.failed.some((c) => c.id === 'debuggable'));
  assert.ok(report.failed.some((c) => c.id === 'activity:.MainActivity'));
});

test('protobuf manifest: exported=true with a filter passes', () => {
  const report = checkManifest(pbManifest({ activityAttrs: [attr('exported', 'true')], withFilter: true }));
  assert.equal(report.ok, true);
});

test('rejects non-manifest input cleanly', () => {
  const report = checkManifest(Buffer.from([0x03, 0x00, 0x08, 0x00]));
  assert.equal(report.ok, false);
  assert.match(report.failed[0].detail, /binary AndroidManifest/);
});
