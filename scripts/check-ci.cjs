#!/usr/bin/env node
'use strict';

// Fail closed unless the exact master commit passed every required GitHub Actions check.
// Read-only API requests; token and response bodies are never logged.
const REQUIRED_CHECKS = [
  { workflow: 'ci.yml', job: 'verify', label: 'CI / verify' },
  { workflow: 'css-lint.yml', job: 'css-lint', label: 'CSS lint / css-lint' },
];

async function apiGet(path, token) {
  let response;
  try {
    response = await fetch(`https://api.github.com${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'escowear-deploy-ci-gate',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('GitHub API request failed');
    return await response.json();
  } catch {
    throw new Error('Could not verify GitHub Actions CI; deployment blocked');
  }
}

function validateInputs(repo, sha, token) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || repo.split('/').some(part => part === '.' || part === '..')) {
    throw new Error('Invalid GitHub repository name');
  }
  if (!/^[a-fA-F0-9]{40}$/.test(sha)) {
    throw new Error('Invalid commit SHA');
  }
  if (!token || !token.trim()) {
    throw new Error('ESCOWEAR_GITHUB_TOKEN is required for the deployment CI gate');
  }
}

// Returns { state, runId, message } where state is success | pending | failed | missing.
async function checkStatus(repo, sha, token, check, request) {
  const short = sha.slice(0, 12);
  const runsPath = `/repos/${repo}/actions/workflows/${check.workflow}/runs?head_sha=${sha}&event=push&branch=master&per_page=30`;
  const runsResponse = await request(runsPath, token);
  const matching = (runsResponse.workflow_runs ?? []).filter(run =>
    run.head_sha === sha && run.event === 'push' &&
    run.head_branch === 'master' &&
    typeof run.path === 'string' && run.path.endsWith(`/${check.workflow}`)
  );
  if (matching.length === 0) {
    return { state: 'missing', message: `No master push ${check.label} run found for ${short}` };
  }

  const latest = matching.sort((a, b) =>
    (b.created_at ?? '').localeCompare(a.created_at ?? '') ||
    (b.id ?? 0) - (a.id ?? 0) ||
    (b.run_attempt ?? 0) - (a.run_attempt ?? 0)
  )[0];
  if (latest.status !== 'completed') {
    return { state: 'pending', runId: latest.id, message: `${check.label} is still running for ${short} (status=${latest.status})` };
  }
  if (latest.conclusion !== 'success') {
    return { state: 'failed', runId: latest.id, message: `${check.label} has not passed for ${short} (status=${latest.status}, conclusion=${latest.conclusion})` };
  }

  // Workflow-level success is not enough: the named job must have passed.
  const jobsResponse = await request(`/repos/${repo}/actions/runs/${latest.id}/jobs?per_page=100`, token);
  const passed = (jobsResponse.jobs ?? []).some(job =>
    job.name === check.job && job.conclusion === 'success' && job.head_sha === sha
  );
  if (!passed) {
    return { state: 'failed', runId: latest.id, message: `${check.label} job did not pass for ${short}` };
  }
  return { state: 'success', runId: latest.id, message: `${check.label} passed for ${short}` };
}

async function ciStatus(repo, sha, token, request = apiGet) {
  validateInputs(repo, sha, token);
  const results = [];
  for (const check of REQUIRED_CHECKS) {
    results.push({ ...check, ...(await checkStatus(repo, sha, token, check, request)) });
  }
  return results;
}

async function verifyCi(repo, sha, token, request = apiGet) {
  const results = await ciStatus(repo, sha, token, request);
  const blocking = results.find(result => result.state !== 'success');
  if (blocking) throw new Error(blocking.message);
  return results.map(result => result.runId);
}

async function main(argv = process.argv.slice(2), token = process.env.ESCOWEAR_GITHUB_TOKEN) {
  if (argv.length !== 2) {
    throw new Error('Usage: check-ci.cjs owner/repo commit-sha');
  }
  const [repo, sha] = argv;
  const runIds = await verifyCi(repo, sha, token);
  console.log(`[deploy] Verified GitHub Actions CI and CSS lint for ${sha.slice(0, 12)} (runs ${runIds.join(', ')})`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[deploy] ERROR: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { REQUIRED_CHECKS, apiGet, ciStatus, verifyCi, main };
