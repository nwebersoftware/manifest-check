import { readZip, readEntry } from '@njweber/store-check/src/zip.mjs';

import { decodeFields, allOf, firstOf } from './pb.mjs';

const stripNs = (name) => (name.includes(':') ? name.slice(name.indexOf(':') + 1) : name);

/* ---------------------------------- AAB (protobuf) ---------------------------------- */

function attrValue(af) {
  const s = firstOf(af, 3, 2);
  if (s) return s.data.toString('utf8');

  // compiled_item -> Item -> primitive (int / boolean / float)
  const ci = firstOf(af, 6, 2);
  if (ci) {
    const item = decodeFields(ci.data);
    const prim = firstOf(item, 7, 2);
    if (prim) {
      const p = decodeFields(prim.data);
      const dec = firstOf(p, 6, 0);
      if (dec) return String(dec.value);
      const hex = firstOf(p, 7, 0);
      if (hex) return String(hex.value);
      const bool = firstOf(p, 8, 0);
      if (bool) return bool.value ? 'true' : 'false';
      const flt = firstOf(p, 3, 5);
      if (flt) return String(flt.value);
    }
  }

  const rid = firstOf(af, 5, 0);
  if (rid) return `@0x${rid.value.toString(16)}`;
  return '';
}

function pbElement(buf) {
  const fs = decodeFields(buf);
  const name = firstOf(fs, 3, 2)?.data.toString('utf8') ?? null;
  const attrs = {};
  for (const a of allOf(fs, 4, 2)) {
    const af = decodeFields(a.data);
    const nm = firstOf(af, 2, 2)?.data.toString('utf8');
    if (nm) attrs[stripNs(nm)] = attrValue(af);
  }
  const children = allOf(fs, 5, 2).map((c) => pbNode(c.data));
  return { name, attrs, children };
}

function pbNode(buf) {
  const fs = decodeFields(buf);
  const el = firstOf(fs, 1, 2);
  if (el) return pbElement(el.data);
  const text = firstOf(fs, 2, 2);
  return { text: text ? text.data.toString('utf8').trim() : '' };
}

/* --------------------------------- plain text XML ---------------------------------- */

export function parseTextManifest(xml) {
  const root = { name: null, attrs: {}, children: [] };
  const stack = [root];
  const tagRe = /<(\/?)([A-Za-z_][\w.:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  let m;
  while ((m = tagRe.exec(xml))) {
    const [, close, name, attrStr, selfClose] = m;
    if (close) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const attrs = {};
    const aRe = /([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let a;
    while ((a = aRe.exec(attrStr))) attrs[stripNs(a[1])] = a[2] ?? a[3] ?? '';
    const node = { name, attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!selfClose) stack.push(node);
  }
  return root.children[0] ?? null;
}

/* ------------------------------------ dispatch ------------------------------------- */

/** Parse a manifest from a buffer: an .aab, a bare protobuf manifest, or text XML. */
export function parseManifest(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);

  if (buf.length >= 2 && buf[0] === 0x03 && buf[1] === 0x00) {
    throw new Error('binary AndroidManifest.xml (from an .apk) is not supported yet — pass the .aab, or the merged/source AndroidManifest.xml');
  }

  const head = buf.subarray(0, 64).toString('latin1').trimStart();
  if (head.startsWith('<')) {
    const root = parseTextManifest(buf.toString('utf8'));
    if (!root) throw new Error('no XML elements found');
    return root;
  }

  // protobuf: top-level XmlNode { element = 1 }
  return pbNode(buf);
}

/** Pull the manifest out of an .aab buffer. */
export function manifestFromAab(aabBuf) {
  const zip = readZip(aabBuf);
  const entry = zip.entries.map((e) => e.name).find((n) => /^base\/manifest\/AndroidManifest\.xml$/.test(n));
  if (!entry) throw new Error('no base/manifest/AndroidManifest.xml in this bundle');
  return readEntry(zip, entry);
}
