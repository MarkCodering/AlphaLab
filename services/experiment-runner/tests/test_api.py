from fastapi.testclient import TestClient

from alphalab_experiment_runner.main import app, receipts

client = TestClient(app)
digest = f"sha256:{'a' * 64}"
body = {
    "contractVersion": "1.0",
    "invocationId": "invocation-reference-1",
    "runId": "run-reference-1",
    "operation": "SUMMARY_STATISTICS",
    "values": [1, 2, 3],
    "seed": 17,
    "approvalDigest": digest,
    "limits": {"timeoutSeconds": 30, "memoryMiB": 256, "cpuMillis": 1000, "outputBytes": 10000},
}


def setup_function() -> None:
    receipts.clear()


def test_exact_approval_digest_is_required() -> None:
    response = client.post("/v1/experiments", json=body)
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "APPROVAL_DIGEST_MISMATCH"


def test_execution_is_deterministic_and_idempotent() -> None:
    first = client.post(
        "/v1/experiments", json=body, headers={"x-alphalab-approval-digest": digest}
    ).json()
    replay = client.post(
        "/v1/experiments", json=body, headers={"x-alphalab-approval-digest": digest}
    ).json()
    assert first == replay
    assert first["status"] == "SUCCEEDED"
    assert first["measurements"]["mean"] == 2
    assert first["environment"]["network"] == "denied"
