import hashlib
import json
import math
from pathlib import Path
from statistics import fmean, pstdev

from .schemas import (
    DomainInferenceRequest,
    DomainInferenceResult,
    LoadModelRequest,
    LoadModelResult,
    ModelManifest,
)


DETERMINISTIC_REVISION = hashlib.sha256(
    b"alphalab-deterministic-statistics-v1"
).hexdigest()


class DeterministicStatisticsProvider:
    manifest = ModelManifest(
        providerId="python-local-runtime",
        modelId="deterministic-statistics-v1",
        revisionDigest=f"sha256:{DETERMINISTIC_REVISION}",
        capabilities=["DOMAIN_INFERENCE"],
        contextLimit=100_000,
        maxConcurrency=4,
        dataBoundary="LOCAL",
        remoteCodeRequired=False,
    )

    def infer(self, request: DomainInferenceRequest) -> DomainInferenceResult:
        values = request.values
        if any(not math.isfinite(value) for value in values):
            return DomainInferenceResult(
                requestId=request.requestId,
                status="FAILED",
                providerId=self.manifest.providerId,
                modelId=request.modelId,
                modelRevisionDigest=self.manifest.revisionDigest,
                errorCode="NON_FINITE_INPUT",
            )
        output = {
            "count": len(values),
            "mean": fmean(values),
            "minimum": min(values),
            "maximum": max(values),
            "populationStandardDeviation": pstdev(values),
            "seed": request.seed,
        }
        normalized = json.dumps(output, sort_keys=True, separators=(",", ":"))
        output["normalizedDigest"] = f"sha256:{hashlib.sha256(normalized.encode()).hexdigest()}"
        return DomainInferenceResult(
            requestId=request.requestId,
            status="SUCCEEDED",
            providerId=self.manifest.providerId,
            modelId=request.modelId,
            modelRevisionDigest=self.manifest.revisionDigest,
            output=output,
        )


def load_local_huggingface_model(request: LoadModelRequest) -> LoadModelResult:
    model_path = Path(request.localPath).expanduser().resolve()
    if not model_path.is_dir():
        return LoadModelResult(
            status="REJECTED",
            modelId=request.modelId,
            errorCode="LOCAL_MODEL_NOT_FOUND",
            message="Model loading requires an existing local directory; Hub identifiers are denied.",
        )
    if request.trustRemoteCode:
        return LoadModelResult(
            status="REJECTED",
            modelId=request.modelId,
            errorCode="REMOTE_CODE_FORBIDDEN",
            message="Remote model code is disabled by policy.",
        )
    try:
        import torch  # noqa: F401
        import transformers  # noqa: F401
    except ImportError:
        return LoadModelResult(
            status="UNSUPPORTED_CAPABILITY",
            modelId=request.modelId,
            errorCode="HUGGINGFACE_EXTRAS_NOT_INSTALLED",
            message="Install the optional huggingface dependency group in this isolated service.",
        )
    return LoadModelResult(
        status="READY",
        modelId=request.modelId,
        message="Local model dependencies and path are available; remote code remains disabled.",
    )
