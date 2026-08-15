from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ModelManifest(StrictModel):
    contractVersion: Literal["1.0"] = "1.0"
    providerId: str
    modelId: str
    revisionDigest: str
    adapterVersion: str = "1.0.0"
    capabilities: list[str]
    contextLimit: int = Field(gt=0)
    maxConcurrency: int = Field(gt=0)
    dataBoundary: Literal["LOCAL", "DEPLOYMENT", "EXTERNAL"]
    remoteCodeRequired: bool


class DomainInferenceRequest(StrictModel):
    contractVersion: Literal["1.0"] = "1.0"
    requestId: str
    modelId: str = "deterministic-statistics-v1"
    operation: Literal["SUMMARY_STATISTICS"]
    values: list[float] = Field(min_length=1, max_length=100_000)
    seed: int = 0
    timeoutMs: int = Field(default=30_000, gt=0, le=300_000)


class DomainInferenceResult(StrictModel):
    contractVersion: Literal["1.0"] = "1.0"
    requestId: str
    status: Literal["SUCCEEDED", "FAILED", "UNSUPPORTED_CAPABILITY"]
    providerId: str
    modelId: str
    modelRevisionDigest: str
    output: dict[str, Any] | None = None
    errorCode: str | None = None


class LoadModelRequest(StrictModel):
    contractVersion: Literal["1.0"] = "1.0"
    modelId: str
    localPath: str
    task: Literal["SEQUENCE_CLASSIFICATION", "FEATURE_EXTRACTION"]
    trustRemoteCode: Literal[False] = False


class LoadModelResult(StrictModel):
    contractVersion: Literal["1.0"] = "1.0"
    status: Literal["READY", "UNSUPPORTED_CAPABILITY", "REJECTED"]
    modelId: str
    errorCode: str | None = None
    message: str
