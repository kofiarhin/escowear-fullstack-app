"""Offline regression tests for the manual deploy CI gate."""
import importlib.util
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "check-ci.py"
spec = importlib.util.spec_from_file_location("check_ci", SCRIPT)
check_ci = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check_ci)

SHA = "a" * 40
REPO = "kofiarhin/escowear-fullstack-app"


def run_info(status="completed", conclusion="success", sha=SHA):
    return {
        "id": 41, "head_sha": sha, "event": "push",
        "head_branch": "master", "path": ".github/workflows/ci.yml",
        "status": status, "conclusion": conclusion, "run_attempt": 1,
    }


class GateTests(unittest.TestCase):
    def run_gate(self, runs, jobs):
        def fake_api(path, token):
            if "/jobs?" in path:
                return {"jobs": jobs}
            return {"workflow_runs": runs}

        with patch.dict(os.environ, {"ESCOWEAR_GITHUB_TOKEN": "test-token"}), \
             patch.object(sys, "argv", ["check-ci.py", REPO, SHA]), \
             patch.object(check_ci, "api_get", side_effect=fake_api):
            check_ci.main()

    def test_successful_exact_commit(self):
        self.run_gate([run_info()], [{"name": "verify", "conclusion": "success", "head_sha": SHA}])

    def test_missing_run_fails(self):
        with self.assertRaises(SystemExit):
            self.run_gate([], [])

    def test_failed_or_pending_ci_fails(self):
        for status, conclusion in [("completed", "failure"), ("in_progress", None)]:
            with self.subTest(status=status), self.assertRaises(SystemExit):
                self.run_gate([run_info(status, conclusion)], [])

    def test_other_commit_fails(self):
        with self.assertRaises(SystemExit):
            self.run_gate([run_info(sha="b" * 40)], [])

    def test_success_without_verify_job_fails(self):
        with self.assertRaises(SystemExit):
            self.run_gate([run_info()], [{"name": "other", "conclusion": "success", "head_sha": SHA}])

    def test_missing_token_fails_before_request(self):
        with patch.dict(os.environ, {"ESCOWEAR_GITHUB_TOKEN": ""}), \
             patch.object(sys, "argv", ["check-ci.py", REPO, SHA]), \
             patch.object(check_ci, "api_get") as api, \
             self.assertRaises(SystemExit):
            check_ci.main()
        api.assert_not_called()


if __name__ == "__main__":
    unittest.main()
