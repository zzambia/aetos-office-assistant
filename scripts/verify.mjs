// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 YOUBIQUO S.r.l.

import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
const test = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'tests/core.test.mjs','tests/fingerprint.test.mjs','tests/markdown.test.mjs','tests/transport.test.mjs','tests/word.test.mjs','tests/xml-fingerprint.test.mjs'], {encoding:'utf8'});
await mkdir('docs', {recursive:true}); await writeFile('docs/automated-test-results.tap',test.stdout + test.stderr);
process.stdout.write(test.stdout); process.stderr.write(test.stderr);
if (test.status !== 0) process.exit(test.status || 1);
const build = spawnSync(process.execPath,['scripts/build.mjs'],{encoding:'utf8'});
process.stdout.write(build.stdout);process.stderr.write(build.stderr);process.exit(build.status || 0);
