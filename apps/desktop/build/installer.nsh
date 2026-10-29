!include "Sections.nsh"

; electron-builder adds the uninstall components page when this hook exists.
; The section is selected by default; upgrades always retain user data.
!macro customUnWelcomePage
  ; The components page already explains the uninstall choices.
!macroend

LangString moyuDeleteData 2052 "同时删除用户数据（聊天、设置、密钥和缓存）"
LangString moyuDeleteData 1033 "Delete user data (chats, settings, credentials and cache)"

!macro customUnInstallSection
  Section "un.$(moyuDeleteData)" moyuDeleteDataSection
    ${IfNot} ${isUpdated}
      ${GetParameters} $R0
      ClearErrors
      ${GetOptions} $R0 "/KEEP_APP_DATA" $R1
      ${If} ${Errors}
        SetShellVarContext current
        !insertmacro moyuCleanProfile "$APPDATA\MoyuBot"
        !insertmacro moyuCleanProfile "$APPDATA\@moyu\desktop"
        ${If} $installMode == "all"
          SetShellVarContext all
        ${EndIf}
      ${EndIf}
    ${EndIf}
  SectionEnd
!macroend

; Delete only app-owned state. Never follow workspace paths from settings.json.
; The non-recursive removals leave workspaces and other user-created files intact.
!macro moyuCleanProfile profile
  Delete "${profile}\moyu\settings.json"
  Delete "${profile}\moyu\secrets.bin.json"
  Delete "${profile}\moyu\secrets.json"
  Delete "${profile}\moyu\memories.json"
  Delete "${profile}\moyu\schedules.json"
  Delete "${profile}\moyu\usage.jsonl"
  Delete "${profile}\moyu\usage.jsonl.recovery"
  Delete "${profile}\moyu\diagnostics.json"
  Delete "${profile}\moyu\desktop-control.json"
  RMDir /r "${profile}\moyu\conversations"
  RMDir /r "${profile}\moyu\backup-before-workspaces"
  RMDir "${profile}\moyu"
  RMDir /r "${profile}\Cache"
  RMDir /r "${profile}\Code Cache"
  RMDir /r "${profile}\GPUCache"
  RMDir /r "${profile}\DawnGraphiteCache"
  RMDir /r "${profile}\DawnWebGPUCache"
  RMDir /r "${profile}\Session Storage"
  RMDir /r "${profile}\Local Storage"
  RMDir /r "${profile}\IndexedDB"
  RMDir /r "${profile}\Network"
  RMDir /r "${profile}\Crashpad"
  RMDir /r "${profile}\logs"
  Delete "${profile}\Preferences"
  Delete "${profile}\Local State"
  Delete "${profile}\TransportSecurity"
  Delete "${profile}\DIPS"
  Delete "${profile}\DIPS-wal"
  Delete "${profile}\DIPS-shm"
  RMDir "${profile}"
!macroend

; Keep the local workspace in the installation folder when uninstalling/upgrading.
; Only names shipped by Electron/electron-builder are eligible for removal.
!macro customRemoveFiles
  SetOutPath $TEMP
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\locales"
  RMDir /r "$INSTDIR\swiftshader"
  !insertmacro moyuRemoveRuntimeFile "MoyuBot.exe"
  !insertmacro moyuRemoveRuntimeFile "${UNINSTALL_FILENAME}"
  !insertmacro moyuRemoveRuntimeFile "chrome_100_percent.pak"
  !insertmacro moyuRemoveRuntimeFile "chrome_200_percent.pak"
  !insertmacro moyuRemoveRuntimeFile "d3dcompiler_47.dll"
  !insertmacro moyuRemoveRuntimeFile "dxcompiler.dll"
  !insertmacro moyuRemoveRuntimeFile "dxil.dll"
  !insertmacro moyuRemoveRuntimeFile "ffmpeg.dll"
  !insertmacro moyuRemoveRuntimeFile "icudtl.dat"
  !insertmacro moyuRemoveRuntimeFile "libEGL.dll"
  !insertmacro moyuRemoveRuntimeFile "libGLESv2.dll"
  !insertmacro moyuRemoveRuntimeFile "LICENSE.electron.txt"
  !insertmacro moyuRemoveRuntimeFile "LICENSES.chromium.html"
  !insertmacro moyuRemoveRuntimeFile "resources.pak"
  !insertmacro moyuRemoveRuntimeFile "snapshot_blob.bin"
  !insertmacro moyuRemoveRuntimeFile "v8_context_snapshot.bin"
  !insertmacro moyuRemoveRuntimeFile "version"
  !insertmacro moyuRemoveRuntimeFile "vk_swiftshader_icd.json"
  !insertmacro moyuRemoveRuntimeFile "vk_swiftshader.dll"
  !insertmacro moyuRemoveRuntimeFile "vulkan-1.dll"
  RMDir "$INSTDIR"
!macroend

!macro moyuRemoveRuntimeFile filename
  Delete "$INSTDIR\${filename}"
!macroend
