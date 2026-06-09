; Custom NSIS script for AUM WP Studio
; Grants the current user write access to the Windows hosts file so that
; WP Studio can register .test domains without requiring UAC on every launch.

!macro customInstall
  ; Grant current user modify rights on the hosts file
  ; so site domain registration works without per-launch elevation.
  ExecWait 'icacls "$WINDIR\System32\drivers\etc\hosts" /grant Users:M'
!macroend

!macro customUninstall
  ; Restore default hosts file permissions on uninstall
  ExecWait 'icacls "$WINDIR\System32\drivers\etc\hosts" /reset'
!macroend
