#!/usr/bin/env node
'use strict';

// Fail closed unless the exact master commit has a successful GitHub Actions CI run.
// Read-only API requests; token and response bodies are never logged.
const WORKFLOW = 'ci.yml';
const JOB_NAME = 'verify';

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

async function verifyCi(repo, sha, token, request = apiGet) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || repo.split('/').some(part => part === '.' || part === '..')) {
    throw new Error('Invalid GitHub repository name');
  }
  if (!/^[a-fA-F0-9]{40}$/.test(sha)) {
    throw new Error('Invalid commit SHA');
  }
  if (!token || !token.trim()) {
    throw new Error('ESCOWEAR_GITHUB_TOKEN is required for the deployment CI gate');
  }

  const runsPath = `/repos/${repo}/actions/workflows/${WORKFLOW}/runs?head_sha=${sha}&event=push&branch=master&per_page=30`;
  const runsResponse = await request(runsPath, token);
  const matching = (runsResponse.workflow_runs ?? []).filter(run =>
    run.head_sha === sha && run.event === 'push' &&
    run.head_branch === 'master' &&
    typeof run.path === 'string' && run.path.endsWith(`/${WORKFLOW}`)
  );
  if (matching.length === 0) {
    throw new Error(`No master push CI workflow found for ${sha.slice(0, 12)}`);
  }

  const latest = matching.sort((a, b) =>
    (b.created_at ?? '').localeCompare(a.created_at ?? '') ||
    (b.id ?? 0) - (a.id ?? 0) ||
    (b.run_attempt ?? 0) - (a.run_attempt ?? 0)
  )[0];
  if (latest.status !== 'completed' || latest.conclusion !== 'success') {
    throw new Error(`CI has not passed for ${sha.slice(0, 12)} (status=${latest.status}, conclusion=${latest.conclusion})`);
  }

  // Workflow-level success is not enough: the verification job must have passed.
  const jobsResponse = await request(`/repos/${repo}/actions/runs/${latest.id}/jobs?per_page=100`, token);
  const passed = (jobsResponse.jobs ?? []).some(job =>
    job.name === JOB_NAME && job.conclusion === 'success' && job.head_sha === sha
  );
  if (!passed) {
    throw new Error(`CI verification job did not pass for ${sha.slice(0, 12)}`);
  }
  return latest.id;
}

async function main(argv = process.argv.slice(2), token = process.env.ESCOWEAR_GITHUB_TOKEN) {
  if (argv.length !== 2) {
    throw new Error('Usage: check-ci.cjs owner/repo commit-sha');
  }
  const [repo, sha] = argv;
  const runId = await verifyCi(repo, sha, token);
  console.log(`[deploy] Verified GitHub Actions CI for ${sha.slice(0, 12)} (run ${runId})`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[deploy] ERROR: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { apiGet, verifyCi, main };
