# Production Cluster Infrastructure Setup (#78)

This guide covers the full infrastructure provisioning for ribix-ide production
on Google Kubernetes Engine (GKE).

## Architecture Overview

The production cluster consists of:

- **GKE Standard cluster** with private nodes, Workload Identity, and Calico network policies
- **Cloud SQL PostgreSQL 15** (HA, automated backups, point-in-time recovery)
- **Memorystore Redis 7** (HA, TLS, auth-enabled)
- **Cloud DNS** managed zone for `ide.ribix.dev`
- **Global HTTP(S) Load Balancer** with static IP
- **Cloud NAT** for controlled outbound traffic
- **KMS** customer-managed encryption keys

## Prerequisites

1. **Google Cloud SDK** (`gcloud CLI`) — [install](https://cloud.google.com/sdk/docs/install)
2. **Terraform** >= 1.5.0 — [install](https://developer.hashicorp.com/terraform/downloads)
3. **kubectl** — [install](https://kubernetes.io/docs/tasks/tools/)
4. **helm** 3.x — [install](https://helm.sh/docs/intro/install/)
5. A GCP project with billing enabled
6. Domain name (`ide.ribix.dev`) with DNS access

## Step 1: Provision Infrastructure with Terraform

### 1.1 Create the Terraform state bucket

```bash
gsutil mb -l us-central1 gs://ribix-ide-terraform-state
gsutil versioning set on gs://ribix-ide-terraform-state
```

### 1.2 Configure variables

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars:
#   project_id = "your-gcp-project-id"
```

### 1.3 Initialize and apply

```bash
terraform init
terraform plan -out=tfplan
terraform apply tfplan
```

This provisions:
- VPC with private subnet + Cloud NAT
- GKE cluster with private nodes + Workload Identity
- Node pool with auto-scaling (1-4 nodes per zone, 3 zones)
- Cloud SQL PostgreSQL (HA, PITR)
- Memorystore Redis (HA, TLS)
- Cloud DNS zone
- Global IP for ingress
- KMS encryption keys

### 1.4 Save outputs

```bash
terraform output -raw db_password | gcloud secrets create ribix-db-password --data-file=-
terraform output -raw cluster_ca_certificate > cluster-ca.crt
```

## Step 2: Get Cluster Credentials

```bash
gcloud container clusters get-credentials ribix-ide-prod \
  --region us-central1 \
  --project YOUR_PROJECT_ID
```

## Step 3: Install Cluster Components

### 3.1 Install cert-manager (for Let's Encrypt TLS)

```bash
helm repo add jetstack https://charts.jetstack.io
helm repo update
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager \
  --create-namespace \
  --set installCRDs=true \
  --set global.leaderElection.namespace=cert-manager
```

### 3.2 Install ingress-nginx

```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update
helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx \
  --create-namespace \
  --set controller.service.loadBalancerIP=$(terraform output -raw ingress_ip)
```

### 3.3 Install the Cloud SQL auth proxy

```bash
helm repo add gcp-cloud-sql-proxy https://cloud-sql-connectors.github.io/cloud-sql-proxy/
helm install cloud-sql-proxy gcp-cloud-sql-proxy/cloud-sql-proxy \
  --namespace ribix-ide \
  --create-namespace \
  --set cloudsql.instanceConnectionName=$(terraform output -raw db_connection_name) \
  --set cloudsql.username=ribix \
  --set cloudsql.password=$(terraform output -raw db_password)
```

## Step 4: Deploy ribix-ide

### 4.1 Create secrets

```bash
kubectl create secret generic ribix-ide-secrets \
  --namespace ribix-ide \
  --from-literal=DATABASE_URL="postgresql://ribix:$(terraform output -raw db_password)@cloud-sql-proxy:5432/ribix" \
  --from-literal=REDIS_URL="rediss://default:$(gcloud redis describe ribix-redis-prod --region us-central1 --format='value(authString)')@$(terraform output -raw redis_host):6379" \
  --from-literal=JWT_SECRET="$(openssl rand -hex 32)"
```

### 4.2 Apply K8s manifests

```bash
kubectl apply -f web-ide/k8s/deployment.yaml
kubectl apply -f web-ide/k8s/tls.yaml
kubectl apply -f web-ide/k8s/monitoring.yaml
kubectl apply -f web-ide/k8s/alerting-rules.yaml
```

### 4.3 Configure DNS

Point your domain to the ingress IP:

```bash
# Get the ingress IP
terraform output ingress_ip

# Create DNS A record in Cloud DNS
gcloud dns record-sets create ide.ribix.dev. \
  --zone=ribix-ide-zone \
  --type=A \
  --ttl=300 \
  --rrdatas=$(terraform output -raw ingress_ip)
```

## Step 5: Verify Deployment

### 5.1 Check pod status

```bash
kubectl get pods -n ribix-ide
kubectl get pods -n ribix-monitoring
```

### 5.2 Test health endpoints

```bash
kubectl port-forward svc/ribix-ide-web -n ribix-ide 8080:80
curl http://localhost:8080/health
# Expected: {"status":"ok","service":"ribix-ide-web","timestamp":...}
```

### 5.3 Verify TLS certificate

```bash
kubectl get certificate -n ribix-ide
# Wait for READY: True

curl -I https://ide.ribix.dev/health
# Expected: HTTP/2 200
```

## Auto-Scaling

The GKE node pool auto-scales from 1 to 4 nodes per zone (3-12 total).
Application-level auto-scaling is configured via the HPA in `deployment.yaml`:

- **Web IDE**: 3-10 pods, 70% CPU / 80% memory target
- **WebSocket**: 2-6 pods (manual scaling recommended for sticky sessions)

## Backup & Disaster Recovery

| Resource | Backup Strategy | Retention |
|----------|----------------|-----------|
| PostgreSQL | Automated daily + PITR | 30 days |
| Redis | No persistence (cache only) | N/A |
| Terraform state | GCS bucket versioning | Indefinite |
| K8s manifests | Git (this repo) | Indefinite |

## Monitoring

See `docs/monitoring-setup.md` for the full monitoring stack documentation.

## Cost Estimate

See `docs/cloud-provider-selection.md` for the detailed cost breakdown.

Approximate monthly cost: **~$579/mo** for a 3-node HA cluster with managed
PostgreSQL and Redis.

## Security Checklist

- [x] Private GKE nodes (no public IPs)
- [x] Workload Identity (no key files)
- [x] Shielded nodes (secure boot + integrity monitoring)
- [x] KMS encryption for cluster secrets
- [x] Network policies (Calico)
- [x] Cloud SQL on private IP only
- [x] Redis with TLS + auth
- [x] Cloud NAT for controlled egress
- [x] RBAC-only (no legacy ABAC)
- [x] Non-root containers in all deployments
- [x] TLS/SSL for all external traffic
