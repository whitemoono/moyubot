const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Compile the real NSIS hooks with all paths redirected into an isolated fixture.
// No installed app, registry entry or real user profile is changed by this test.
test('NSIS uninstall deletes selected state, preserves unchecked/upgrade data and all project files', { skip: process.platform !== 'win32' }, () => {
  const cache = path.join(process.env.LOCALAPPDATA, 'electron-builder', 'Cache');
  const findCompiler = (folder) => {
    if (!fs.existsSync(folder)) return;
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isFile() && entry.name === 'makensis.exe') return full;
      if (entry.isDirectory()) { const match = findCompiler(full); if (match) return match; }
    }
  };
  const compiler = findCompiler(cache);
  assert.ok(compiler, 'Build the Windows installer first to provision NSIS');
  const folder = fs.mkdtempSync(path.resolve('.work', 'uninstall-test-'));
  const include = fs.readFileSync('apps/desktop/build/installer.nsh', 'utf8').replaceAll('$APPDATA', '$moyuTestProfileRoot');
  fs.writeFileSync(path.join(folder, 'hooks.nsh'), include);
  const script = `Unicode true
!include LogicLib.nsh
!include FileFunc.nsh
!include MUI2.nsh
!define UNINSTALL_FILENAME "Uninstall.exe"
!macro _testUpdated _a _b _t _f
  ClearErrors
  \${GetOptions} $CMDLINE "--updated" $R9
  IfErrors \u0060\${_f}\u0060 \u0060\${_t}\u0060
!macroend
!define isUpdated '\"\" testUpdated \"\"'
Var installMode
Var moyuTestProfileRoot
!include "hooks.nsh"
Name "Isolated MoyuBot uninstall test"
OutFile "generate.exe"
RequestExecutionLevel user
SilentInstall silent
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"
Section
  WriteUninstaller "$EXEDIR\\Uninstall.exe"
SectionEnd
Section "Uninstall"
  SectionIn RO
  !insertmacro customRemoveFiles
SectionEnd
!insertmacro customUnInstallSection
Function un.onInit
  StrCpy $installMode "current"
  StrCpy $moyuTestProfileRoot "$INSTDIR\\..\\profile"
  ClearErrors
  \${GetOptions} $CMDLINE "/UNCHECK_DATA" $R0
  \${IfNot} \${Errors}
    SectionSetFlags \${moyuDeleteDataSection} 0
  \${EndIf}
FunctionEnd
`;
  fs.writeFileSync(path.join(folder, 'test.nsi'), script);
  const run = (command, args, cwd = folder) => {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 60000 });
    assert.equal(result.status, 0, `${command}: ${result.error?.message ?? ''}\n${result.stdout}\n${result.stderr}`);
  };
  run(compiler, ['/V2', 'test.nsi']);
  run(path.join(folder, 'generate.exe'), ['/S']);
  for (const [name, flags, deletes] of [['default', [], true], ['unchecked', ['/UNCHECK_DATA'], false], ['upgrade', ['--updated'], false], ['keep-app-data', ['/KEEP_APP_DATA'], false]]) {
    const scenario = path.join(folder, name), install = path.join(scenario, 'install'), profile = path.join(scenario, 'profile');
    const file = (relative, content = 'fixture') => { const full = path.join(scenario, relative); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, content); };
    file('install/MoyuBot.exe'); file('install/resources/app.asar'); file('install/workspace/project.txt'); file('install/notes.txt');
    for (const root of ['MoyuBot', '@moyu/desktop']) {
      file(`profile/${root}/moyu/settings.json`); file(`profile/${root}/moyu/secrets.bin.json`);
      file(`profile/${root}/moyu/conversations/chat.json`); file(`profile/${root}/moyu/backup-before-workspaces/settings.json`);
      file(`profile/${root}/Cache/data`); file(`profile/${root}/moyu/workspace/report.md`);
    }
    file('profile/another-app/settings.json');
    fs.copyFileSync(path.join(folder, 'Uninstall.exe'), path.join(install, 'Uninstall.exe'));
    run(path.join(install, 'Uninstall.exe'), ['/S', ...flags, `_?=${install}`]);
    assert.equal(fs.existsSync(path.join(install, 'MoyuBot.exe')), false, name);
    assert.equal(fs.existsSync(path.join(install, 'resources')), false, name);
    assert.ok(fs.existsSync(path.join(install, 'workspace/project.txt')), name);
    assert.ok(fs.existsSync(path.join(install, 'notes.txt')), name);
    for (const root of ['MoyuBot', '@moyu/desktop']) {
      for (const entry of ['moyu/settings.json', 'moyu/secrets.bin.json', 'moyu/conversations/chat.json', 'moyu/backup-before-workspaces/settings.json', 'Cache/data']) assert.equal(fs.existsSync(path.join(profile, root, entry)), !deletes, `${name}: ${root}/${entry}`);
      assert.ok(fs.existsSync(path.join(profile, root, 'moyu/workspace/report.md')), name);
    }
    assert.ok(fs.existsSync(path.join(profile, 'another-app/settings.json')), name);
  }
});
