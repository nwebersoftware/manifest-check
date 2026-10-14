#!/usr/bin/env node
import { readFileSync } from 'node:fs';

import { checkManifest, formatReport } from '../src/check.mjs';

const HELP = `manifest-check — audit an Android manifest before Play does

Usage:
  manifest-check <app.aab | AndroidManifest.xml>

Checks: android:debuggable, usesCleartextTraffic, allowBackup, exported components with
<intent-filter>, targetSdkVersion, and declared (sensitive) permissions.

Notes: reads an .aab (protobuf manifest) or a text AndroidManifest.xml (source or merged).
Binary .apk manifests are not supported yet.

Exit: 0 clean · 1 blocking issue(s) · 2 bad input.
`;

const args = process.argv.slice(2);
if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
  process.stdout.write(HELP);
  process.exit(args.length === 0 ? 2 : 0);
}

const file = args[0];
let buf;
try {
  buf = readFileSync(file);
} catch (e) {
  process.stderr.write(`cannot read ${file}: ${e.message}\n`);
  process.exit(2);
}

const report = checkManifest(buf);
process.stdout.write(formatReport(report, file) + '\n');
process.exit(report.ok ? 0 : 1);
