from fastapi.testclient import TestClient

from alphalab_verifier_runtime.main import app

client = TestClient(app)
digest = f"sha256:{'b' * 64}"


def test_missing_evidence_is_never_a_pass() -> None:
    response = client.post(
        "/v1/verifications",
        json={
            "contractVersion": "1.0",
            "verificationId": "verification-1",
            "targetVersionId": "target-version-1",
            "requiredReproductions": 3,
            "requireArtifacts": True,
            "reproductions": [],
            "provenanceComplete": False,
            "blockingSupervisorFindings": 0,
        },
    )
    assert response.json()["outcome"] == "NOT_TESTED"


def test_three_identical_complete_runs_pass() -> None:
    reproductions = [
        {
            "runId": f"run-{index}",
            "status": "SUCCEEDED",
            "normalizedResultDigest": digest,
            "artifactDigests": [digest],
        }
        for index in range(3)
    ]
    response = client.post(
        "/v1/verifications",
        json={
            "contractVersion": "1.0",
            "verificationId": "verification-2",
            "targetVersionId": "target-version-1",
            "requiredReproductions": 3,
            "requireArtifacts": True,
            "reproductions": reproductions,
            "provenanceComplete": True,
            "blockingSupervisorFindings": 0,
        },
    )
    assert response.json()["outcome"] == "PASS"
    assert response.json()["normalizedResultDigest"] == digest
