$node = "C:\Users\nvandewetering\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
& $node .\node_modules\typescript\bin\tsc -p .\tsconfig.test.json
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $node .\.test-dist\lib\calculations\portfolio.test.js
exit $LASTEXITCODE
