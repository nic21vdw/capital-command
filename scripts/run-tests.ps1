$node = if ($env:node) { $env:node } else { "node" }
& $node .\node_modules\typescript\bin\tsc -p .\tsconfig.test.json
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $node .\.test-dist\lib\calculations\portfolio.test.js
exit $LASTEXITCODE
