# Ribix IDE Production Infrastructure (Terraform)

This directory contains Terraform infrastructure-as-code for provisioning the
ribix-ide production cluster on Google Kubernetes Engine (GKE).

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  GCP Project (ribix-ide-prod)                               │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  VPC (10.10.0.0/20)                                  │   │
│  │                                                      │   │
│  │  ┌────────────────────────────────────────────────┐  │   │
│  │  │  GKE Cluster (ribix-ide-prod)                  │  │   │
│  │  │  ├── Node Pool (e2-standard-4, 1-4 per zone)   │  │   │
│  │  │  ├── Workload Identity enabled                 │  │   │
│  │  │  ├── Private nodes (no public IPs)             │  │   │
│  │  │  ├── Network Policy enforcement (Calico)       │  │   │
│  │  │  └── Database encryption (KMS)                 │  │   │
│  │  └────────────────────────────────────────────────┘  │   │
│  │                                                      │   │
│  │  ┌──────────────┐  ┌──────────────┐                  │   │
│  │  │  Cloud SQL   │  │  Memorystore │                  │   │
│  │  │  PostgreSQL  │  │  Redis 7     │                  │   │
│  │  │  (HA, PITR)  │  │  (HA, TLS)   │                  │   │
│  │  └──────────────┘  └──────────────┘                  │   │
│  │                                                      │   │
│  │  ┌──────────────┐  ┌──────────────┐                  │   │
│  │  │  Cloud NAT   │  │  Cloud DNS   │                  │   │
│  │  │  (egress)    │  │  (managed)   │                  │   │
│  │  └──────────────┘  └──────────────┘                  │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌──────────────┐                                           │
│  │  KMS KeyRing │  ┌──────────────────────┐                 │
│  │  (encryption)│  │  Global IP (ingress) │                 │
│  └──────────────┘  └──────────────────────┘                 │
└─────────────────────────────────────────────────────────────┘
```

## Prerequisites

1. **Google Cloud SDK** (`gcloud`) installed and authenticated
2. **Terraform** >= 1.5.0
3. A GCP project with billing enabled
4. The following APIs enabled (Terraform will enable them automatically):
   - `container.googleapis.com` (GKE)
   - `compute.googleapis.com` (VPC, NAT, DNS)
   - `cloudsql.googleapis.com` (managed PostgreSQL)
   - `servicenetworking.googleapis.com` (private services)
   - `dns.googleapis.com` (Cloud DNS)
   - `certificatemanager.googleapis.com` (SSL certs)
   - `monitoring.googleapis.com` (Cloud Monitoring)
   - `logging.googleapis.com` (Cloud Logging)

## Deployment

### 1. Create the Terraform state bucket

```bash
gsutil mb -l us-central1 gs://ribix-ide-terraform-state
```

### 2. Configure variables

```bash
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your project ID and settings
```

### 3. Initialize and deploy

```bash
terraform init
terraform plan -out=tfplan
terraform apply tfplan
```

### 4. Get cluster credentials

```bash
gcloud container clusters get-credentials ribix-ide-prod \
  --region us-central1 \
  --project YOUR_PROJECT_ID
```

### 5. Deploy the K8s manifests

```bash
kubectl apply -f web-ide/k8s/deployment.yaml
kubectl apply -f web-ide/k8s/tls.yaml
kubectl apply -f web-ide/k8s/monitoring.yaml
kubectl apply -f web-ide/k8s/alerting-rules.yaml
```

## Cost Estimate (monthly)

| Resource                | Spec                    | Est. Cost/mo |
|------------------------|-------------------------|--------------|
| GKE cluster            | Autopilot or Standard   | $73          |
| Node pool (3 nodes)    | e2-standard-4 (4 vCPU)  | $240         |
| Cloud SQL PostgreSQL   | db-custom-2-7680, HA    | $130         |
| Memorystore Redis      | 1GB, STANDARD_HA        | $55          |
| Cloud NAT              | + data processing       | $35          |
| Load Balancer          | Global HTTP(S) LB       | $25          |
| Cloud DNS              | 1 zone + queries        | $1           |
| KMS                    | 1 key + key operations  | $3           |
| Storage (PVCs)         | 100GB SSD               | $17          |
| **Total (estimated)**  |                         | **~$579/mo** |

## Security Features

- **Private GKE nodes**: No public IP addresses on worker nodes
- **Workload Identity**: Pods authenticate to GCP via IAM, no key files
- **Shielded nodes**: Secure boot + integrity monitoring
- **KMS encryption**: Cluster secrets encrypted at rest with customer-managed keys
- **Network policies**: Calico-enforced pod-to-pod network isolation
- **Cloud SQL**: Private IP only, automated backups with PITR, HA across zones
- **Redis**: TLS transit encryption, auth-enabled
- **NAT gateway**: Controlled outbound internet access

## Disaster Recovery

- **Database**: Automated daily backups + 30-day retention + point-in-time recovery
- **Cluster**: Auto-repair + auto-upgrade enabled
- **Node pool**: Auto-scaling 1-4 nodes per zone across 3 zones
- **Terraform state**: Stored in GCS bucket with versioning

## Outputs

After `terraform apply`, the following outputs are available:

- `cluster_endpoint`: GKE API endpoint
- `cluster_ca_certificate`: Cluster CA cert for kubectl
- `db_connection_name`: Cloud SQL connection name
- `redis_host`: Memorystore Redis host
- `ingress_ip`: Global IP for the ingress load balancer
- `db_password`: PostgreSQL password (sensitive — store in Secret Manager)
