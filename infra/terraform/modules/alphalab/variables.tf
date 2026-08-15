variable "deployment_profile" {
  description = "Maintained AlphaLab deployment profile."
  type        = string
  validation {
    condition     = contains(["local-cpu", "local-gpu", "on-premise", "air-gapped", "kubernetes", "aws", "gcp", "azure"], var.deployment_profile)
    error_message = "deployment_profile must be one of the maintained profiles."
  }
}

variable "environment" {
  description = "Non-secret environment identifier."
  type        = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,30}$", var.environment))
    error_message = "environment must be a lowercase slug."
  }
}

variable "image_digests" {
  description = "Immutable application image references keyed by service."
  type        = map(string)
  validation {
    condition = length(var.image_digests) >= 6 && alltrue([
      for reference in values(var.image_digests) : can(regex("@sha256:[a-f0-9]{64}$", reference))
    ])
    error_message = "At least six service images must be pinned by sha256 digest."
  }
}

variable "public_ingress" {
  description = "Whether an authenticated ingress is reachable beyond the private network."
  type        = bool
  default     = false
}

variable "gpu_enabled" {
  description = "Enable a GPU-capable model-runtime pool when supported by the profile."
  type        = bool
  default     = false
}

variable "retention_days" {
  description = "Default operational record retention; scientific evidence may have stricter project policy."
  type        = number
  default     = 90
  validation {
    condition     = var.retention_days >= 1 && var.retention_days <= 3650
    error_message = "retention_days must be between 1 and 3650."
  }
}
