# Build VHDL FSM Visualizer VSIX package

Write-Host "Installing dependencies..." -ForegroundColor Cyan
npm install

Write-Host "Compiling TypeScript..." -ForegroundColor Cyan
npm run compile

Write-Host "Packaging VSIX..." -ForegroundColor Cyan
npx vsce package

Write-Host "Done! VSIX file created." -ForegroundColor Green
Write-Host "To install in VS Code: Extensions -> Install from VSIX" -ForegroundColor Gray
