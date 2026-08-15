output "deployment_contract" {
  description = "Reviewable, non-secret deployment contract consumed by environment-specific infrastructure owners."
  value       = terraform_data.deployment_contract.output
}

output "required_secret_handles" {
  description = "Secret-manager handles that the environment must bind; values never enter the plan."
  value = [
    "alphalab/database-url",
    "alphalab/object-store-credentials",
    "alphalab/session-signing-key",
  ]
}
