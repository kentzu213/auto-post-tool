const fs = require('fs');
const path = require('path');
const yamlPath = path.join(
  process.cwd(),
  'node_modules/.pnpm/@eslint+eslintrc@2.1.4/node_modules/js-yaml'
);
const yaml = require(yamlPath);

const file = '.github/workflows/ci.yml';
const raw = fs.readFileSync(file, 'utf8');
const doc = yaml.load(raw); // throws on invalid YAML

const checks = [];
const ok = (name, cond) => checks.push([name, !!cond]);

const job = doc.jobs['build-and-publish'];
ok('YAML parsed', !!doc);
ok('build-and-publish job exists', !!job);
ok('needs lint+test+build', JSON.stringify(job.needs) === JSON.stringify(['lint', 'test', 'build']));
ok('job permissions packages:write', job.permissions && job.permissions['packages'] === 'write');
ok('top-level permissions contents:read', doc.permissions && doc.permissions['contents'] === 'read');
ok('matrix has 3 apps', job.strategy.matrix.include.length === 3);
ok('matrix images correct',
  job.strategy.matrix.include.map((m) => m.image).join(',') ===
    'autopost-api,autopost-web,autopost-worker');

const steps = job.steps;
const findUses = (u) => steps.find((s) => s.uses && s.uses.startsWith(u));
ok('checkout@v4 pinned', !!findUses('actions/checkout@v4'));
ok('buildx@v3 pinned', !!findUses('docker/setup-buildx-action@v3'));
ok('build-push@v6 pinned', !!findUses('docker/build-push-action@v6'));
ok('login@v3 pinned', !!findUses('docker/login-action@v3'));
ok('trivy pinned 0.36.0', !!findUses('aquasecurity/trivy-action@0.36.0'));

const trivy = steps.find((s) => s.uses && s.uses.includes('trivy-action'));
ok('trivy severity HIGH,CRITICAL', trivy.with.severity === 'HIGH,CRITICAL');
ok('trivy exit-code 1', String(trivy.with['exit-code']) === '1');

const scanBuild = steps.find((s) => s.name === 'Build image (local, for scan)');
ok('scan build load:true push:false', scanBuild.with.load === true && scanBuild.with.push === false);
ok('scan build passes COMMIT_SHA build-arg', /COMMIT_SHA=\$\{\{ github\.sha \}\}/.test(scanBuild.with['build-args']));
ok('scan build passes BUILD_ID build-arg', /BUILD_ID=\$\{\{ github\.run_id \}\}/.test(scanBuild.with['build-args']));

const pushStep = steps.find((s) => s.name === 'Build and push to GHCR (release only)');
ok('push step gated on is_release', pushStep.if === "steps.meta.outputs.is_release == 'true'");
ok('push step push:true', pushStep.with.push === true);
ok('push tags include sha-', /:sha-\$\{\{ github\.sha \}\}/.test(pushStep.with.tags));
ok('push tags include semver', /:\$\{\{ steps\.meta\.outputs\.semver \}\}/.test(pushStep.with.tags));
ok('push tags use repository_owner', /ghcr\.io\/\$\{\{ github\.repository_owner \}\}/.test(pushStep.with.tags));

const login = steps.find((s) => s.uses && s.uses.includes('login-action'));
ok('login gated on is_release', login.if === "steps.meta.outputs.is_release == 'true'");
ok('login uses GITHUB_TOKEN', login.with.password === '${{ secrets.GITHUB_TOKEN }}');
ok('login registry ghcr.io', login.with.registry === 'ghcr.io');

ok('triggers include master push', doc.on.push.branches.includes('master'));
ok('triggers include v* tags', doc.on.push.tags.includes('v*'));

let failed = 0;
for (const [name, pass] of checks) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
  if (!pass) failed++;
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
