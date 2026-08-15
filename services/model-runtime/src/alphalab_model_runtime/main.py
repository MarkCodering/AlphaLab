import os

import uvicorn
from fastapi import FastAPI

from .providers import DeterministicStatisticsProvider, load_local_huggingface_model
from .schemas import DomainInferenceRequest, DomainInferenceResult, LoadModelRequest, LoadModelResult

app = FastAPI(
    title="AlphaLab Model Runtime",
    version="1.0",
    docs_url=None if os.getenv("ALPHALAB_DISABLE_DOCS") == "1" else "/docs",
)
provider = DeterministicStatisticsProvider()


@app.get("/v1/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "alphalab-model-runtime", "contractVersion": "1.0"}


@app.get("/v1/models")
def models() -> list[dict[str, object]]:
    return [provider.manifest.model_dump()]


@app.post("/v1/inference/domain", response_model=DomainInferenceResult)
def domain_inference(request: DomainInferenceRequest) -> DomainInferenceResult:
    if request.modelId != provider.manifest.modelId:
        return DomainInferenceResult(
            requestId=request.requestId,
            status="UNSUPPORTED_CAPABILITY",
            providerId=provider.manifest.providerId,
            modelId=request.modelId,
            modelRevisionDigest=provider.manifest.revisionDigest,
            errorCode="MODEL_NOT_LOADED",
        )
    return provider.infer(request)


@app.post("/v1/models/load", response_model=LoadModelResult)
def load_model(request: LoadModelRequest) -> LoadModelResult:
    return load_local_huggingface_model(request)


def run() -> None:
    uvicorn.run(
        "alphalab_model_runtime.main:app",
        host=os.getenv("ALPHALAB_MODEL_HOST", "127.0.0.1"),
        port=int(os.getenv("ALPHALAB_MODEL_PORT", "8100")),
    )


if __name__ == "__main__":
    run()
