terraform {
  required_version = ">= 1.5.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }

  backend "gcs" {
    bucket = "ribix-ide-terraform-state"
    prefix = "ribix-ide-prod"
  }
}

# ---------------------------------------------------------------------------
# Variables
# ---------------------------------------------------------------------------

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

# ---------------------------------------------------------------------------
# Locals
# ---------------------------------------------------------------------------

locals {
  network_name    = "${var.cluster_name}-network"
  subnet_name     = "${var.cluster_name}-subnet"
  subnet_cidr     = "10.10.0.0/20"
  pods_cidr       = "10.20.0.0/16"
  services_cidr   = "10.30.0.0/16"
}

# ---------------------------------------------------------------------------
# Enable required GCP APIs
# ---------------------------------------------------------------------------

locals {
  enabled_apis = [
    "container.googleapis.com",
    "compute.googleapis.com",
    "cloudsql.googleapis.com",
    "servicenetworking.googleapis.com",
    "dns.googleapis.com",
    "certificatemanager.googleapis.com",
    "monitoring.googleapis.com",
    "logging.googleapis.com",
  ]
}

resource "google_project_service" "apis" {
  for_each = toset(local.enabled_apis)
  project  = var.project_id
  service  = each.value

  disable_on_destroy = false
}

# ---------------------------------------------------------------------------
# VPC & Networking
# ---------------------------------------------------------------------------

resource "google_compute_network" "vpc" {
  name                    = local.network_name
  project                 = var.project_id
  auto_create_subnetworks = false
  depends_on              = [google_project_service.apis]
}

resource "google_compute_subnetwork" "subnet" {
  name                     = local.subnet_name
  project                  = var.project_id
  region                   = var.region
  network                  = google_compute_network.vpc.id
  ip_cidr_range            = local.subnet_cidr
  private_ip_google_access = true

  secondary_ip_range {
    range_name    = "pods"
    ip_cidr_range = local.pods_cidr
  }
  secondary_ip_range {
    range_name    = "services"
    ip_cidr_range = local.services_cidr
  }
}

# Cloud NAT for outbound internet access from private nodes
resource "google_compute_router" "router" {
  name    = "${var.cluster_name}-router"
  project = var.project_id
  region  = var.region
  network = google_compute_network.vpc.id
}

resource "google_compute_router_nat" "nat" {
  name                               = "${var.cluster_name}-nat"
  project                            = var.project_id
  region                             = var.region
  router                             = google_compute_router.router.name
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"
}

# ---------------------------------------------------------------------------
# GKE Cluster
# ---------------------------------------------------------------------------

resource "google_container_cluster" "primary" {
  name             = var.cluster_name
  project          = var.project_id
  location         = var.region
  remove_default_node_pool = true
  initial_node_count       = 1

  network    = google_compute_network.vpc.name
  subnetwork = google_compute_subnetwork.subnet.name

  ip_allocation_policy {
    cluster_secondary_range_name  = "pods"
    services_secondary_range_name = "services"
  }

  # Private cluster — nodes have no public IPs
  private_cluster_config {
    enable_private_nodes    = true
    enable_private_endpoint = false  # Keep control plane endpoint public for CI access
    master_ipv4_cidr_block  = "172.16.0.0/28"
  }

  # Workload Identity for secure pod-to-GCP access
  workload_identity_config {
    workload_pool = "${var.project_id}.svc.id.goog"
  }

  # Security: disable legacy ABAC, use RBAC only
  enable_legacy_abac = false

  # Add-ons
  addons_config {
    http_load_balancing {
      disabled = false
    }
    horizontal_pod_autoscaling {
      disabled = false
    }
    network_policy_config {
      disabled = false
    }
  }

  # Network policy enforcement
  network_policy {
    enabled = true
    provider = "CALICO"
  }

  # Database encryption
  database_encryption {
    state    = "ENCRYPTED"
    key_name = google_kms_crypto_key.cluster_db_key.id
  }

  # Master authorized networks (restrict control plane access)
  master_auth {
    client_certificate_config {
      issue_client_certificate = false
    }
  }

  depends_on = [
    google_project_service.apis,
    google_compute_subnetwork.subnet,
  ]
}

# ---------------------------------------------------------------------------
# Node Pool
# ---------------------------------------------------------------------------

resource "google_container_node_pool" "primary_nodes" {
  name       = "${var.cluster_name}-node-pool"
  project    = var.project_id
  location   = var.region
  cluster    = google_container_cluster.primary.name
  node_count = var.min_node_count

  autoscaling {
    min_node_count = var.min_node_count
    max_node_count = var.max_node_count
  }

  management {
    auto_repair  = true
    auto_upgrade = true
  }

  node_config {
    machine_type = var.machine_type
    disk_size_gb = 100
    disk_type    = "pd-ssd"

    # Workload Identity service account
    service_account = google_service_account.ribix_nodes.email
    oauth_scopes = [
      "https://www.googleapis.com/auth/cloud-platform",
    ]

    # Security: workload metadata endpoint
    workload_metadata_config {
      mode = "GKE_METADATA"
    }

    # Security: shielded nodes
    shielded_instance_config {
      enable_secure_boot          = true
      enable_integrity_monitoring = true
    }

    labels = {
      app    = "ribix-ide"
      env    = "production"
    }

    tags = ["ribix-ide", "gke-node"]
  }
}

# ---------------------------------------------------------------------------
# Service Account for nodes
# ---------------------------------------------------------------------------

resource "google_service_account" "ribix_nodes" {
  account_id   = "ribix-ide-nodes"
  display_name = "Ribix IDE GKE Nodes"
  project      = var.project_id
}

resource "google_project_iam_member" "ribix_nodes_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.ribix_nodes.email}"
}

resource "google_project_iam_member" "ribix_nodes_monitoring" {
  project = var.project_id
  role    = "roles/monitoring.metricWriter"
  member  = "serviceAccount:${google_service_account.ribix_nodes.email}"
}

# ---------------------------------------------------------------------------
# KMS key for cluster database encryption
# ---------------------------------------------------------------------------

resource "google_kms_key_ring" "ribix" {
  name     = "ribix-keyring"
  project  = var.project_id
  location = var.region
  depends_on = [google_project_service.apis]
}

resource "google_kms_crypto_key" "cluster_db_key" {
  name     = "cluster-db-encryption-key"
  key_ring = google_kms_key_ring.ribix.id
  purpose  = "ENCRYPT_DECRYPT"

  rotation_period = "7776000s"  # 90 days

  lifecycle {
    prevent_destroy = true
  }
}

# ---------------------------------------------------------------------------
# Cloud SQL PostgreSQL (managed database)
# ---------------------------------------------------------------------------

resource "google_sql_database_instance" "postgres" {
  name             = "ribix-postgres-prod"
  project          = var.project_id
  region           = var.region
  database_version = "POSTGRES_15"

  settings {
    tier              = "db-custom-2-7680"
    disk_size         = 50
    disk_type         = "PD_SSD"
    availability_type = "REGIONAL"  # HA across zones

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      backup_retention_settings {
        retained_backups = 30
        retention_unit   = "COUNT"
      }
    }

    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.vpc.id
    }

    database_flags {
      name  = "log_connections"
      value = "on"
    }
    database_flags {
      name  = "log_disconnections"
      value = "on"
    }
  }

  depends_on = [google_service_account.ribix_nodes]
}

resource "google_sql_database" "ribix_db" {
  name     = "ribix"
  project  = var.project_id
  instance = google_sql_database_instance.postgres.name
}

resource "google_sql_user" "ribix_user" {
  name     = "ribix"
  project  = var.project_id
  instance = google_sql_database_instance.postgres.name
  password = random_password.db_password.result
}

resource "random_password" "db_password" {
  length  = 32
  special = true
}

# ---------------------------------------------------------------------------
# Memorystore Redis (managed cache)
# ---------------------------------------------------------------------------

resource "google_redis_instance" "redis" {
  name           = "ribix-redis-prod"
  project        = var.project_id
  region         = var.region
  tier           = "STANDARD_HA"
  memory_size_gb = 1
  redis_version  = "REDIS_7_0"

  authorized_network = google_compute_network.vpc.id

  transit_encryption_mode = "SERVER_AUTHENTICATION"
  auth_enabled            = true

  depends_on = [google_project_service.apis]
}

# ---------------------------------------------------------------------------
# Cloud DNS managed zone
# ---------------------------------------------------------------------------

resource "google_dns_managed_zone" "ribix" {
  name        = "ribix-ide-zone"
  project     = var.project_id
  dns_name    = "${var.domain}."
  description = "DNS zone for ribix-ide production"
  visibility  = "public"
}

# ---------------------------------------------------------------------------
# Global IP for ingress
# ---------------------------------------------------------------------------

resource "google_compute_global_address" "ingress_ip" {
  name    = "ribix-ide-ingress-ip"
  project = var.project_id
  region  = var.region
}

# ---------------------------------------------------------------------------
# Outputs
# ---------------------------------------------------------------------------

output "cluster_endpoint" {
  description = "GKE cluster API endpoint"
  value       = google_container_cluster.primary.endpoint
  sensitive   = true
}

output "cluster_ca_certificate" {
  description = "GKE cluster CA certificate"
  value       = google_container_cluster.primary.master_auth[0].cluster_ca_certificate
  sensitive   = true
}

output "db_connection_name" {
  description = "Cloud SQL connection name"
  value       = google_sql_database_instance.postgres.connection_name
}

output "redis_host" {
  description = "Memorystore Redis host"
  value       = google_redis_instance.redis.host
  sensitive   = true
}

output "ingress_ip" {
  description = "Global IP for the ingress load balancer"
  value       = google_compute_global_address.ingress_ip.address
}

output "db_password" {
  description = "PostgreSQL password (store in a secret manager)"
  value       = random_password.db_password.result
  sensitive   = true
}
