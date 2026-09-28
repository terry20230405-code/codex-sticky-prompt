import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('launcher preserves the Microsoft Store package identity', async () => {
  const launcher = await readFile(new URL('../Start-CodexStickyPrompt.ps1', import.meta.url), 'utf8');

  assert.match(launcher, /IApplicationActivationManager/);
  assert.match(launcher, /Start-PackagedCodex -AppUserModelId/);
  assert.doesNotMatch(launcher, /Start-Process -FilePath \$appExe/);
});
