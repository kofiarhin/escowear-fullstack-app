#!/usr/bin/env node
'use strict';

// GitHub Actions deploy gate. CI and CSS lint each trigger the deploy workflow when
// they finish, so the first finisher normally sees the other still running and waits.
// Decisions: deploy | wait | superseded | blocked. Only API errors exit non-zero.
const fs = require('node:fs');
const { apiGet, ciStatus } = require('./check-ci.cjs');

async function decide(repo, sha, token, request = apiGet) {
  const results = await ciStatus(repo, sha, token, request);
  const branch = await request(`/repos/${repo}/branches/master`, token);
  const tip = branch?.commit?.sha;
  if (!/^[a-f0-9]{40}$/.test(tip ?? '')) throw new Error('Could not read the master branch tip');
  if (tip !== sha) {
    return { decision: 'superseded', message: `${sha.slice(0, 12)} is no longer the master tip (${tip.slice(0, 12)}); not deploying an outdated commit` };
  }
  const failed = results.find(result => result.state === 'failed');
  if (failed) return { decision: 'blocked', message: failed.message };
  const waiting = results.find(result => result.state !== 'success');
  if (waiting) return { decision: 'wait', message: `${waiting.message}; its completion will trigger deployment` };
  return { decision: 'deploy', message: `All required checks passed for master tip ${sha.slice(0, 12)}` };
}

async function main(argv = process.argv.slice(2), env = process.env) {
  if (argv.length !== 2) throw new Error('Usage: deploy-gate.cjs owner/repo commit-sha');
  const [repo, sha] = argv;
  const { decision, message } = await decide(repo, sha, env.ESCOWEAR_GITHUB_TOKEN);
  console.log(`${decision === 'blocked' ? '::warning::' : '::notice::'}Deploy gate: ${decision}. ${message}`);
  if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `decision=${decision}\n`);
  return decision;
}

if (require.main === module) {
  main().catch(error => {
    console.error(`::error::Deploy gate failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { decide, main };
