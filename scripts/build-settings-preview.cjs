'use strict';
// Build a local mock-bridge preview; never writes the production config or PBWs.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[2] || path.join(root, '../preview/chmu-weather'));
const source = fs.readFileSync(path.join(root, 'src/config.html'), 'utf8');
const bridge = fs.readFileSync(path.join(__dirname, 'settings-review-bridge.js'), 'utf8');
const base = source.match(/:root\{[^}]+\}/)[0];
const dark = source.match(/@media\(prefers-color-scheme:dark\)\{(:root\{[^}]+\})\}/)[1];
const previewCss = base.replace(':root', 'html[data-review-theme="light"]') + dark.replace(':root', 'html[data-review-theme="dark"]') +
'.review-toolbar{border:1px dashed var(--line);padding:14px;margin-bottom:22px;border-radius:12px;background:var(--soft);color:var(--ink);font-size:12px}.review-toolbar strong{font-size:13px}.review-toolbar p{font-size:12px;line-height:1.5;margin:7px 0}.review-toolbar nav,.review-toolbar>div{display:flex;flex-wrap:wrap;gap:7px 12px;margin:10px 0}.review-toolbar a{color:var(--blue);padding:4px 0}.review-toolbar button{font-size:12px;min-height:38px;padding:7px 9px}.review-toolbar details{margin-top:8px}.review-toolbar ol{margin:0;padding-left:20px}';
let html = source.replaceAll('__CHMU_BUILD_VARIANT__', 'public');
const reviewCsp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'";
html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="' + reviewCsp + '">');
html = html.replace('</head>', '<style data-review-only>' + previewCss + '</style></head>');
html = html.replace('<script>', '<script data-review-only>\n' + bridge.replaceAll('</script', '<\\/script') + '\n</script>\n<script>');
fs.mkdirSync(output, {recursive:true});
fs.writeFileSync(path.join(output, 'index.html'), html);
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
fs.writeFileSync(path.join(output,'preview-manifest.json'), JSON.stringify({
  kind:'local-settings-review',productionSource:'src/config.html',sourceSha256:sha(source),
  fixtureSource:'scripts/settings-review-bridge.js',fixtureSha256:sha(bridge),
  previewSha256:sha(html),productionScriptModified:false,
  previewOnlyChanges:['public build marker','local mock Pebble bridge and review controls','theme variables copied from actual production CSS','review-only Content Security Policy'],
  contentSecurityPolicy:reviewCsp,
  networkRequests:false,phoneActions:false,simulatedData:true
},null,2)+'\n');
console.log(JSON.stringify({output,sourceSha256:sha(source),simulatedData:true}));
