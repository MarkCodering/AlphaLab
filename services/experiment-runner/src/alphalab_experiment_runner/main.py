import hashlib
import json
import math
import os
from statistics import fmean, pstdev
from typing import Literal

import uvicorn
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ResourceLimits(StrictModel):
    timeoutSeconds: int = Field(gt=0, le=300)
    memoryMiB: int = Field(gt=0, le=4096)
    cpuMillis: int = Field(gt=0, le=4000)
    outputBytes: int = Field(gt=0, le=10_000_000)


class ExperimentRequest(StrictModel):
    contractVersion: Literal["1.0"] = "1.0"
    invocationId: str
    runId: str
    operation: Literal["SUMMARY_STATISTICS"]
    values: list[float] = Field(min_length=1, max_length=100_000)
    seed: int
    approvalDigest: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")
    limits: ResourceLimits


class ExperimentResult(StrictModel):
    contractVersion: Literal["1.0"] = "1.0"
    invocationId: str
    runId: str
    status: Literal["SUCCEEDED", "FAILED"]
    normalizedResultDigest: str
    measurements: dict[str, float | int]
    artifactDigest: str
    environment: dict[str, str | int | bool]
    errorCode: str | None = None


app = FastAPI(title="AlphaLab Experiment Runner", version="1.0")
receipts: dict[str, ExperimentResult] = {}


@app.get("/v1/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "alphalab-experiment-runner", "contractVersion": "1.0"}


@app.post("/v1/experiments", response_model=ExperimentResult)
def execute(
    request: ExperimentRequest,
    x_alphalab_approval_digest: str | None = Header(default=None),
) -> ExperimentResult:
    if x_alphalab_approval_digest != request.approvalDigest:
        raise HTTPException(status_code=403, detail={"code": "APPROVAL_DIGEST_MISMATCH"})
    prior = receipts.get(request.invocationId)
    if prior is not None:
        return prior
    if any(not math.isfinite(value) for value in request.values):
        result = ExperimentResult(
            invocationId=request.invocationId,
            runId=request.runId,
            status="FAILED",
            normalizedResultDigest=f"sha256:{'0' * 64}",
            measurements={},
            artifactDigest=f"sha256:{'0' * 64}",
            environment={"network": "denied", "seed": request.seed, "builtInOperation": True},
            errorCode="NON_FINITE_INPUT",
        )
        receipts[request.invocationId] = result
        return result
    measurements: dict[str, float | int] = {
        "count": len(request.values),
        "mean": fmean(request.values),
        "minimum": min(request.values),
        "maximum": max(request.values),
        "populationStandardDeviation": pstdev(request.values),
    }
    normalized = json.dumps(
        {"measurements": measurements, "seed": request.seed}, sort_keys=True, separators=(",", ":")
    ).encode()
    digest = hashlib.sha256(normalized).hexdigest()
    result = ExperimentResult(
        invocationId=request.invocationId,
        runId=request.runId,
        status="SUCCEEDED",
        normalizedResultDigest=f"sha256:{digest}",
        measurements=measurements,
        artifactDigest=f"sha256:{digest}",
        environment={
            "network": "denied",
            "seed": request.seed,
            "builtInOperation": True,
            "cpuMillisLimit": request.limits.cpuMillis,
            "memoryMiBLimit": request.limits.memoryMiB,
        },
    )
    receipts[request.invocationId] = result
    return result


@app.get("/v1/experiments/{invocation_id}", response_model=ExperimentResult)
def receipt(invocation_id: str) -> ExperimentResult:
    if invocation_id not in receipts:
        raise HTTPException(status_code=404, detail={"code": "RECEIPT_NOT_FOUND"})
    return receipts[invocation_id]


def run() -> None:
    uvicorn.run(
        "alphalab_experiment_runner.main:app",
        host=os.getenv("ALPHALAB_EXPERIMENT_HOST", "127.0.0.1"),
        port=int(os.getenv("ALPHALAB_EXPERIMENT_PORT", "8101")),
    )


if __name__ == "__main__":
    run()
