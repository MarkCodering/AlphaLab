#!/usr/bin/env bash
set -euo pipefail

terraform fmt -check -recursive infra/terraform

for alphalab_profile in kubernetes aws gcp azure on-premise; do
  terraform -chdir="infra/terraform/profiles/${alphalab_profile}" init -backend=false -input=false >/dev/null
  terraform -chdir="infra/terraform/profiles/${alphalab_profile}" validate
  terraform -chdir="infra/terraform/profiles/${alphalab_profile}" plan \
    -refresh=false \
    -input=false \
    -lock=false \
    -var-file=../../reference.auto.tfvars.example \
    -out="/tmp/alphalab-${alphalab_profile}.tfplan" >/dev/null
done
