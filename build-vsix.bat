@echo off
REM Build VHDL FSM Visualizer VSIX package

echo Installing dependencies...
call npm install

echo Compiling TypeScript...
call npm run compile

echo Packaging VSIX...
call npx vsce package

echo.
echo Done! VSIX file created.
echo To install in VS Code: Extensions -^> Install from VSIX
pause
