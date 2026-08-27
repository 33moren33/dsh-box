; Hooks into Tauri's NSIS installer.
;
; Tauri offers four insertion points and this file uses three of them. Two jobs
; only, and both of them are the same job seen from opposite ends: make the
; installed copy reachable by name, and leave nothing behind that outlives the
; folder it belongs to.
;
; ⛔ There is one thing these hooks deliberately do NOT attempt. The page that
; says "an older version is already installed" is drawn before any hook runs
; (PREINSTALL is inserted inside the install section, after every page), so a
; registration whose uninstaller has been deleted by hand cannot be cleaned up
; in time to stop that page appearing. Choosing "do not uninstall" walks past
; it and the installation overwrites the stale entry — that is the way through,
; and it belongs in the README rather than in code that cannot reach it.
;
; ⭐ Everything here runs through the program's own command line rather than
; being reimplemented in NSIS. Writing PATH from an installer is the usual
; approach and it is a trap: NSIS strings are capped at 1024 characters in a
; default build, and a PATH long enough to be worth appending to is exactly the
; one that will be silently truncated. The command line has no such cap, keeps
; a copy of the old value, and reads back what it wrote.

!define LEGACY_NAME "dsh-clean-boot"

; What the program was called before 2026-08-20. A new installer only ever
; looks for its own name, so this registration and its shortcut would outlive
; every future install and uninstall with nobody to claim them.
!macro DropLegacyRegistration
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${LEGACY_NAME}"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${LEGACY_NAME}"
  Delete "$SMPROGRAMS\${LEGACY_NAME}.lnk"
  Delete "$DESKTOP\${LEGACY_NAME}.lnk"
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro DropLegacyRegistration
  ; The binary was called dsh-box-shell.exe up to and including 0.3.4. Installing
  ; over such a copy leaves that file sitting there — 11 MB of a program that
  ; still runs, still looks like this one, and would be found by anything that
  ; searches a folder for us. An upgrade should not leave two of us behind.
  Delete "$INSTDIR\dsh-box-shell.exe"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  Push $R9

  ; The wizard asked which language to install in; that answer is the user's
  ; first statement of preference and it should not have to be made twice.
  ; 2052 is SimpChinese; anything else here means the English list was chosen.
  StrCpy $R9 "en"
  ${If} $LANGUAGE == 2052
    StrCpy $R9 "zh"
  ${EndIf}
  nsExec::ExecToStack '"$INSTDIR\${MAINBINARYNAME}.exe" config lang $R9 --json'
  Pop $R9
  Pop $R9

  ; And put this folder on the user's own PATH, so `dsh-box` is a word that
  ; works. Refusals are on purpose left alone: the command declines when another
  ; copy is already registered, and an installer quietly reordering somebody's
  ; PATH to win that contest would be the wrong way to settle it.
  nsExec::ExecToStack '"$INSTDIR\${MAINBINARYNAME}.exe" path add --json'
  Pop $R9
  Pop $R9

  Pop $R9
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  Push $R9
  ; Before the files go, while there is still a program able to undo this.
  nsExec::ExecToStack '"$INSTDIR\${MAINBINARYNAME}.exe" path rm --json'
  Pop $R9
  Pop $R9
  Pop $R9
  !insertmacro DropLegacyRegistration
!macroend
