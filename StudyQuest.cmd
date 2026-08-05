@echo off
setlocal
set "STUDYQUEST_ROOT=%~dp0"
set "APP_DIR=%~dp0portable\StudyQuest-win32-x64"
set "APP_EXE=%APP_DIR%\StudyQuest.exe"

if not exist "%APP_EXE%" (
  echo StudyQuest executable was not found.
  echo Expected: %APP_EXE%
  pause
  exit /b 1
)

start "" /D "%APP_DIR%" "%APP_EXE%"
endlocal
