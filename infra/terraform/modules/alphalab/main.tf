locals {
  services = {
    web               = { port = 3000, replicas = 2 }
    api               = { port = 4310, replicas = 2 }
    worker            = { port = 4311, replicas = 2 }
    model-runtime     = { port = 8100, replicas = 1 }
    experiment-runner = { port = 8101, replicas = 1 }
    verifier-runtime  = { port = 8102, replicas = 2 }
  }

  security_contract = {
    default_egress_deny         = true
    run_as_non_root             = true
    read_only_root_filesystem   = true
    privileged_containers       = false
    runtime_socket_mount        = false
    production_apply_from_ci    = false
    workload_identity_preferred = true
    encrypted_storage_required  = true
  }
}

resource "terraform_data" "deployment_contract" {
  input = {
    profile         = var.deployment_profile
    environment     = var.environment
    image_digests   = var.image_digests
    services        = local.services
    security        = local.security_contract
    public_ingress  = var.public_ingress
    gpu_enabled     = var.gpu_enabled
    retention_days  = var.retention_days
    apply_authority = "infrastructure-operator-only"
  }

  lifecycle {
    precondition {
      condition     = !(var.deployment_profile == "air-gapped" && var.public_ingress)
      error_message = "The air-gapped profile cannot enable public ingress."
    }
  }
}
