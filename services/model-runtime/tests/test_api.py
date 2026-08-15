from fastapi.testclient import TestClient

from alphalab_model_runtime.main import app

client = TestClient(app)


def test_health_and_capability_discovery() -> None:
    assert client.get("/v1/health").json()["status"] == "ok"
    models = client.get("/v1/models").json()
    assert models[0]["dataBoundary"] == "LOCAL"
    assert models[0]["remoteCodeRequired"] is False


def test_deterministic_domain_inference() -> None:
    request = {
        "contractVersion": "1.0",
        "requestId": "request-1",
        "modelId": "deterministic-statistics-v1",
        "operation": "SUMMARY_STATISTICS",
        "values": [1, 2, 3],
        "seed": 7,
    }
    first = client.post("/v1/inference/domain", json=request).json()
    second = client.post("/v1/inference/domain", json=request).json()
    assert first == second
    assert first["status"] == "SUCCEEDED"
    assert first["output"]["mean"] == 2


def test_hub_identifier_and_remote_code_are_not_accepted() -> None:
    response = client.post(
        "/v1/models/load",
        json={
            "contractVersion": "1.0",
            "modelId": "untrusted-model",
            "localPath": "vendor/model-from-hub",
            "task": "FEATURE_EXTRACTION",
            "trustRemoteCode": False,
        },
    )
    assert response.json()["status"] == "REJECTED"
    assert response.json()["errorCode"] == "LOCAL_MODEL_NOT_FOUND"
