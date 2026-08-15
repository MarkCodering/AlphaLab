import os
from typing import Literal

import uvicorn
from fastapi import FastAPI
from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Reproduction(StrictModel):
    runId: str
    status: Literal["SUCCEEDED", "FAILED"]
    normalizedResultDigest: str | None = None
    artifactDigests: list[str] = []


class VerificationRequest(StrictModel):
    contractVersion: Literal["1.0"] = "1.0"
    verificationId: str
    targetVersionId: str
    requiredReproductions: int = Field(default=3, ge=1, le=20)
    requireArtifacts: bool = True
    reproductions: list[Reproduction]
    provenanceComplete: bool
    blockingSupervisorFindings: int = Field(default=0, ge=0)


class Predicate(StrictModel):
    name: str
    outcome: Literal["PASS", "FAIL", "NOT_TESTED"]
    detail: str


class VerificationResult(StrictModel):
    contractVersion: Literal["1.0"] = "1.0"
    verificationId: str
    outcome: Literal["PASS", "FAIL", "NOT_TESTED"]
    predicates: list[Predicate]
    normalizedResultDigest: str | None = None


app = FastAPI(title="AlphaLab Verifier Runtime", version="1.0")


@app.get("/v1/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "alphalab-verifier-runtime", "contractVersion": "1.0"}


@app.post("/v1/verifications", response_model=VerificationResult)
def verify(request: VerificationRequest) -> VerificationResult:
    successful = [run for run in request.reproductions if run.status == "SUCCEEDED"]
    digests = {run.normalizedResultDigest for run in successful if run.normalizedResultDigest}
    enough_runs = len(successful) >= request.requiredReproductions
    identical = enough_runs and len(digests) == 1
    artifacts_complete = enough_runs and (
        not request.requireArtifacts or all(run.artifactDigests for run in successful)
    )
    predicates = [
        Predicate(
            name="reproduction_count",
            outcome="PASS" if enough_runs else "NOT_TESTED",
            detail=f"{len(successful)} of {request.requiredReproductions} successful reproductions",
        ),
        Predicate(
            name="normalized_result_identity",
            outcome="PASS" if identical else ("FAIL" if enough_runs else "NOT_TESTED"),
            detail="All normalized result digests match" if identical else "Identity is not established",
        ),
        Predicate(
            name="artifact_integrity",
            outcome="PASS" if artifacts_complete else "NOT_TESTED",
            detail="Artifacts are present for every successful run" if artifacts_complete else "Artifacts are incomplete",
        ),
        Predicate(
            name="provenance",
            outcome="PASS" if request.provenanceComplete else "NOT_TESTED",
            detail="Provenance is complete" if request.provenanceComplete else "Provenance is incomplete",
        ),
        Predicate(
            name="supervisor_findings",
            outcome="PASS" if request.blockingSupervisorFindings == 0 else "FAIL",
            detail=f"{request.blockingSupervisorFindings} blocking findings",
        ),
    ]
    outcomes = {predicate.outcome for predicate in predicates}
    outcome: Literal["PASS", "FAIL", "NOT_TESTED"]
    if "FAIL" in outcomes:
        outcome = "FAIL"
    elif "NOT_TESTED" in outcomes:
        outcome = "NOT_TESTED"
    else:
        outcome = "PASS"
    return VerificationResult(
        verificationId=request.verificationId,
        outcome=outcome,
        predicates=predicates,
        normalizedResultDigest=next(iter(digests)) if len(digests) == 1 else None,
    )


def run() -> None:
    uvicorn.run(
        "alphalab_verifier_runtime.main:app",
        host=os.getenv("ALPHALAB_VERIFIER_HOST", "127.0.0.1"),
        port=int(os.getenv("ALPHALAB_VERIFIER_PORT", "8102")),
    )


if __name__ == "__main__":
    run()
