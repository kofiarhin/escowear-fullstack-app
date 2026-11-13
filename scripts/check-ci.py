#!/usr/bin/env python3
"""Fail closed unless GitHub Actions CI passed for the exact master commit.

Read-only GitHub Actions API calls; never prints tokens or response bodies.
"""
import json
import os
import re
import sys
import urllib.error
import urllib.request

API = "https://api.github.com"
WORKFLOW = "ci.yml"
JOB_NAME = "verify"


def fail(message):
    print(f"[deploy] ERROR: {message}", file=sys.stderr)
    sys.exit(1)


def api_get(path, token):
    request = urllib.request.Request(
        API + path,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": "Bearer " + token,
            "User-Agent": "escowear-deploy-ci-gate",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.load(response)
    except (urllib.error.URLError, ValueError, TimeoutError) as exc:
        fail(f"Could not verify GitHub Actions CI ({type(exc).__name__}); deployment blocked")


def main():
    if len(sys.argv) != 3:
        fail("Usage: check-ci.py owner/repo commit-sha")
    repo, sha = sys.argv[1:]
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo):
        fail("Invalid GitHub repository name")
    if not re.fullmatch(r"[a-fA-F0-9]{40}", sha):
        fail("Invalid commit SHA")

    token = os.environ.get("ESCOWEAR_GITHUB_TOKEN", "").strip()
    if not token:
        fail("ESCOWEAR_GITHUB_TOKEN is required for the deployment CI gate")

    path = f"/repos/{repo}/actions/workflows/{WORKFLOW}/runs?head_sha={sha}&event=push&branch=master&per_page=30"
    runs = api_get(path, token).get("workflow_runs", [])
    matching = [
        run for run in runs
        if run.get("head_sha") == sha
        and run.get("event") == "push"
        and run.get("head_branch") == "master"
        and run.get("path", "").endswith("/" + WORKFLOW)
    ]
    if not matching:
        fail(f"No master push CI workflow found for {sha[:12]}")

    latest = max(matching, key=lambda run: (run.get("created_at", ""), run.get("id", 0), run.get("run_attempt", 0)))
    if latest.get("status") != "completed" or latest.get("conclusion") != "success":
        fail(f"CI has not passed for {sha[:12]} (status={latest.get('status')}, conclusion={latest.get('conclusion')})")

    # A workflow-level success is not enough: ensure the intended verification job ran.
    jobs = api_get(f"/repos/{repo}/actions/runs/{latest['id']}/jobs?per_page=100").get("jobs", [])
    if not any(job.get("name") == JOB_NAME and job.get("conclusion") == "success" and job.get("head_sha") == sha for job in jobs):
        fail(f"CI verification job did not pass for {sha[:12]}")
    print(f"[deploy] Verified GitHub Actions CI for {sha[:12]} (run {latest['id']})")


if __name__ == "__main__":
    main()
