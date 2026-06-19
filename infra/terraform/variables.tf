# Terraform variables for ribix-ide production infrastructure
# Copy this file to terraform.tfvars and fill in your values.

variable "project_id" {
  description = "GCP project ID for the ribix-ide production cluster"
  type        = string
}

variable "region" {
  description = "GCP region for the cluster"
  type        = string
  default     = "us-central1"
}

variable "zone" {
  description = "GCP zone for zonal resources"
  type        = string
  default     = "us-central1-a"
}

variable "cluster_name" {
  description = "Name of the GKE cluster"
  type        = string
  default     = "ribix-ide-prod"
}

variable "domain" {
  description = "Domain name for the IDE"
  type        = string
  default     = "ide.ribix.dev"
}

variable "min_node_count" {
  description = "Minimum number of nodes per zone"
  type        = number
  default     = 1
}

variable "max_node_count" {
  description = "Maximum number of nodes per zone"
  type        = number
  default     = 4
}

variable "machine_type" {
  description = "GCE machine type for cluster nodes"
  type        = string
  default     = "e2-standard-4"
}
