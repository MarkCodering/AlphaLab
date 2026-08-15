terraform { required_version = ">= 1.10.0" }

module "alphalab" {
  source             = "../../modules/alphalab"
  deployment_profile = "kubernetes"
  environment        = "reference-kubernetes"
  image_digests      = var.image_digests
  public_ingress     = false
}

variable "image_digests" { type = map(string) }
output "deployment_contract" { value = module.alphalab.deployment_contract }
