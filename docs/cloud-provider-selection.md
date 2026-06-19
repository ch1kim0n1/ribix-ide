# Ribix IDE — Cloud Provider Selection

> **ADR-003** — Decision record selecting a cloud provider to host the
> production Kubernetes cluster for the ribix-ide web IDE application.

## Status

**Accepted** — 2026-06-19

## Context

Ribix IDE is a VS Code-based web IDE that runs in the browser and supports
real-time collaboration. The production deployment must host the following
components on a single Kubernetes cluster:

| Component | Technology | Notes |
|---|---|---|
| Web frontend | Node.js / Vite static bundle | Served via Kubernetes `Deployment` + `Service` |
| Collaboration server | Node.js (WebSocket) | Long-lived connections; sticky sessions required |
| Backend API | Node.js / Express | REST + SSE for agent streaming |
| Database | PostgreSQL | Managed service preferred |
| Cache / pub-sub | Redis | Session cache, SSE fan-out |
| Ingress | NGINX Ingress + cert-manager | TLS termination, WebSocket upgrade |
| Monitoring | Prometheus + Grafana | Cluster metrics, app metrics, alerting |

### Workload profile

- **Initial scale**: ~100 concurrent users, 3–5 node cluster
- **Growth target**: ~1,000 concurrent users within 12 months
- **Traffic shape**: WebSocket-heavy (long-lived), bursty SSE streams, moderate
  REST API load, low database write volume
- **Latency sensitivity**: collaboration edits < 200 ms p95; AI first-token
  < 1 s p95 (see `docs/slos.md`)
- **Availability target**: 99.9% web IDE availability (error budget ~4.3 min/month)

### Decision drivers

1. **Cost** — bootstrapped/small-scale production; monthly run cost matters.
2. **Operational simplicity** — managed Kubernetes + managed Postgres + managed
   Redis reduce toil. The team is small.
3. **Managed Kubernetes quality** — control-plane reliability, upgrade
   experience, autoscaling maturity.
4. **Regional availability** — users are spread across North America and Europe;
   a provider with broad regions avoids cross-continent latency.
5. **Ecosystem fit** — existing tooling, IAM, container registry, secrets
   manager, and CI integration.
6. **Managed vs self-managed** — self-managed Postgres/Redis on the cluster is
   possible but adds backup, HA, and on-call burden we want to avoid at this
   scale.

## Considered Options

Three providers were evaluated for hosting a managed Kubernetes cluster plus
managed PostgreSQL and Redis:

- **AWS** — EKS + RDS for PostgreSQL + ElastiCache for Redis
- **GCP** — GKE + Cloud SQL for PostgreSQL + Memorystore for Redis
- **Azure** — AKS + Azure Database for PostgreSQL + Azure Cache for Redis

A self-managed alternative (Postgres/Redis as Helm charts on the cluster) was
considered and rejected for the initial launch; see §"Managed vs Self-Managed"
below.

## Comparison: Managed Kubernetes Services

| Feature | AWS EKS | GCP GKE | Azure AKS |
|---|---|---|---|
| Control-plane price (flat) | $0.10/min ≈ **$73/mo** per cluster | **Free** (Standard) / ~$0.10/h Autopilot | **Free** |
| Control-plane SLA | 99.95% | 99.95% (Standard) / 99.9% (Autopilot) | 99.9% (free) / 99.95% (Uptime SLA tier) |
| Node autoscaling | Cluster Autoscaler / Karpenter | Standard built-in / Autopilot native | Cluster Autoscaler built-in |
| Autopilot / managed nodes | Fargate (limited daemonset support) | **Autopilot** (fully managed nodes) | AKS Automatic (preview) |
| Integrated ingress / LB | ALB LBC (AWS-specific annotations) | **GCE Ingress** (native, simple) | AGIC or standard NGINX |
| Built-in IAM workload identity | IRSA (config per-service) | **Workload Identity** (native, simple) | Azure AD Workload Identity |
| Container registry | ECR ($0.10/GB-month + transfer) | **Artifact Registry** ($0.10/GB-month) | ACR ($0.10/GB-month) |
| Secrets manager | AWS Secrets Manager / Parameter Store | **Secret Manager** (cheap, simple) | Key Vault |
| Upgrade experience | Manual / EKS Anywhere tooling | **Auto-upgrade channels** (Rapid/Regular/Stable) | Auto-upgrade (patch + image) |
| Logging/metrics native | CloudWatch (extra cost, coarse) | **Cloud Logging/Monitoring** (integrated) | Azure Monitor (integrated) |
| WebSocket support at LB | ALB (supported, sticky via cookies) | **GLB** (native sticky, HTTP/2, WS) | AGIC + App Gateway (supported) |
| Maturity / community docs | Very high | Very high | High |

### Notes on Kubernetes services

- **GKE Standard** offers the best balance: free control plane, full node
  control, and mature auto-upgrade channels. **GKE Autopilot** removes node
  management entirely but charges a per-pod premium and restricts
  privileged workloads (relevant for the web IDE's per-user container
  workspaces if we later add them).
- **EKS** is the most mature but the $73/mo control-plane fee is a fixed
  tax at small scale, and Fargate's daemonset restrictions complicate
  monitoring/logging agents.
- **AKS** has a free control plane but historically the weakest upgrade
  story and more friction with workload identity setup.

## Comparison: Managed PostgreSQL & Redis

| Feature | AWS RDS / ElastiCache | GCP Cloud SQL / Memorystore | Azure DB / Cache |
|---|---|---|---|
| Postgres HA (standby) | Multi-AZ (+$) | Regional HA (included in tier) | Zone-redundant HA (+$) |
| Automated backups + PITR | Yes | Yes | Yes |
| Min price (small, HA) | ~$60–90/mo | ~$50–80/mo | ~$60–90/mo |
| Redis min price (small) | ~$15–40/mo | ~$35–75/mo (Basic/Standard) | ~$50–80/mo |
| Read replicas | Yes (+$) | Yes (+$) | Yes (+$) |
| Integration with K8s | Via IRSA + Secrets Manager | **Native Workload Identity** | Azure AD identity |

GCP's managed Postgres and Redis are competitively priced and integrate
cleanly with GKE via Workload Identity without extra secret-sync operators.

## Comparison: Regional Availability

| Provider | Regions (NA + EU) | Notes |
|---|---|---|
| AWS | ~20 NA/EU regions | Broadest; cheapest in `us-east-1` |
| GCP | ~10 NA/EU regions | `us-central1`, `europe-west1` well-peered |
| Azure | ~20 NA/EU regions | Strong in enterprise; paired regions |

All three cover our target geographies. For a single-region initial launch,
GCP `us-central1` or `europe-west1` give excellent peering to both continents.

## Comparison: Ecosystem & Existing Tooling

| Concern | AWS | GCP | Azure |
|---|---|---|---|
| CI integration | GitHub Actions OIDC | **GitHub Actions OIDC** (simplest) | GitHub Actions OIDC |
| IaC | Terraform (mature) | **Terraform / Config Connector** | Terraform / Bicep |
| CDN for static frontend | CloudFront | **Cloud CDN** (cheap, integrated) | Azure Front Door |
| DNS | Route 53 | Cloud DNS | Azure DNS |
| Cost tooling | Cost Explorer | **Billing reports + labels** | Cost Management |

## Managed vs Self-Managed

| Component | Self-managed on K8s | Managed service | Decision |
|---|---|---|---|
| PostgreSQL | CloudNativePG / Zalando operator | Cloud SQL / RDS / Azure DB | **Managed** — HA, backups, PITR without on-call |
| Redis | Redis Sentinel / Redis operator | Memorystore / ElastiCache | **Managed** — replication + failover handled |
| Ingress controller | NGINX (Helm) | n/a (self-managed on all 3) | **Self-managed** — uniform across providers |
| Prometheus/Grafana | kube-prometheus-stack | Cloud-native managed metrics | **Self-managed** — portability + cost control |
| Cert-manager | Helm | n/a | **Self-managed** — uses provider DNS/LB |

Rationale: at ~100 users, the cost of managed Postgres/Redis is comparable to
running them on the cluster, but managed removes backup windows, HA failover
testing, and 3 a.m. pages. Ingress, monitoring, and cert-manager stay
self-managed for portability and to avoid provider lock-in.

## Cost Estimates

Estimates assume a **3-node** cluster in a US region, on-demand pricing,
~100 GB block storage, a single-zone managed Postgres (HA optional), a small
Redis, one regional load balancer, 50 GB container registry, and 100 GB
egress. Prices are approximate monthly USD and exclude promotional credits.

### AWS (EKS + RDS + ElastiCache)

| Item | Spec | Monthly cost |
|---|---|---|
| EKS control plane | flat | $73.00 |
| 3 × worker nodes | t3.medium (2 vCPU, 4 GB) | ~$90.00 |
| ALB | 1 LCU-hour baseline | ~$20.00 |
| EBS storage | 300 GB gp3 | ~$30.00 |
| RDS PostgreSQL (db.t4g.micro, 20 GB) | single-AZ | ~$18.00 |
| RDS Multi-AZ (optional) | +standby | +$18.00 |
| ElastiCache Redis (cache.t3.micro) | single-node | ~$15.00 |
| ECR | 50 GB | ~$5.00 |
| Egress | 100 GB | ~$9.00 |
| Secrets Manager / misc | small | ~$6.00 |
| **Total (single-AZ DB)** | | **~$266/mo** |
| **Total (HA DB)** | | **~$284/mo** |

### GCP (GKE + Cloud SQL + Memorystore)

| Item | Spec | Monthly cost |
|---|---|---|
| GKE Standard control plane | free | $0.00 |
| 3 × worker nodes | e2-medium (2 vCPU, 4 GB) | ~$70.00 |
| Cloud Load Balancer (GLB) | 1 forwarding rule + traffic | ~$20.00 |
| Persistent disk | 300 GB pd-balanced | ~$24.00 |
| Cloud SQL PostgreSQL (db-custom-1-3840, 20 GB) | single-zone | ~$40.00 |
| Cloud SQL HA (optional) | +standby | +$40.00 |
| Memorystore Redis (Basic 1 GB) | small | ~$35.00 |
| Artifact Registry | 50 GB | ~$5.00 |
| Egress | 100 GB | ~$8.50 |
| Secret Manager / misc | small | ~$2.00 |
| **Total (single-zone DB)** | | **~$204/mo** |
| **Total (HA DB)** | | **~$244/mo** |

### Azure (AKS + Azure DB + Azure Cache)

| Item | Spec | Monthly cost |
|---|---|---|
| AKS control plane (free tier) | free | $0.00 |
| 3 × worker nodes | Standard_B2s (2 vCPU, 4 GB) | ~$60.00 |
| Load Balancer (Standard) | 1 LB + outbound | ~$25.00 |
| Managed disk | 300 GB SSD | ~$24.00 |
| Azure DB PostgreSQL (Flexible, 1 vCPU, 20 GB) | single-zone | ~$50.00 |
| Azure DB HA (optional) | zone-redundant | +$50.00 |
| Azure Cache for Redis (Basic C0) | small | ~$50.00 |
| ACR | 50 GB | ~$5.00 |
| Egress | 100 GB | ~$9.00 |
| Key Vault / misc | small | ~$2.00 |
| **Total (single-zone DB)** | | **~$225/mo** |
| **Total (HA DB)** | | **~$275/mo** |

### Cost summary

| Provider | Single-zone DB | HA DB | Notes |
|---|---|---|---|
| AWS | ~$266 | ~$284 | $73 control-plane tax inflates small-scale cost |
| **GCP** | **~$204** | **~$244** | Free control plane; cheapest at this scale |
| Azure | ~$225 | ~$275 | Free control plane; pricier Redis |

## Comparison Matrix (Summary)

| Criterion | AWS | GCP | Azure |
|---|---|---|---|
| Control-plane cost | $73/mo | **Free** | Free |
| Estimated monthly cost (3-node, HA DB) | ~$284 | **~$244** | ~$275 |
| Managed K8s maturity | High | **High** | High |
| Auto-upgrade experience | Manual | **Best (channels)** | Good |
| Workload identity simplicity | OK (IRSA) | **Best** | OK |
| WebSocket LB support | Good | **Best (GLB)** | Good |
| Managed Postgres price/perf | Good | **Best** | Good |
| Managed Redis price | Good | OK | Weakest |
| Regional coverage | **Best** | Good | Best |
| Ecosystem / CI integration | Good | **Best (OIDC)** | Good |
| Lock-in risk | Medium | Low–Medium | Medium |
| **Overall for ribix-ide** | 2nd | **1st** | 3rd |

## Decision

**Adopt Google Cloud Platform (GCP) with GKE Standard** as the production
cloud provider for ribix-ide.

### Rationale

1. **Lowest cost at target scale.** GKE's free control plane saves ~$73/mo
   versus EKS, and Cloud SQL is competitively priced. At ~100 users this is
   a meaningful percentage of total run cost (~15–25%).
2. **Best managed Kubernetes experience.** GKE Standard gives full node
   control with auto-upgrade channels, native workload identity, and a
   first-class global load balancer that handles WebSocket sticky sessions
   cleanly — directly relevant to the collaboration server.
3. **Operational simplicity.** Workload Identity, Secret Manager, Cloud SQL,
   and Memorystore integrate with minimal operators, reducing toil for a
   small team and avoiding the secret-sync plumbing required by IRSA.
4. **Sufficient regional coverage.** `us-central1` (initial) with
   `europe-west1` as a follow-on region covers our user base with strong
   cross-continent peering.
5. **Portability preserved.** By self-managing NGINX Ingress,
   cert-manager, and kube-prometheus-stack, the application layer remains
   provider-agnostic. Switching providers later would require replacing
   the managed Postgres/Redis endpoints and the LB, not the app manifests.

### When to reconsider

- If GCP pricing changes materially or credits expire.
- If we require a region where GCP is not present but AWS/Azure are.
- If workload mix shifts to heavy egress or multi-region active-active,
   where AWS's broader region mesh and cheaper inter-AZ transfer win.
- If enterprise customers mandate data residency on AWS/Azure-only regions.

## Deployment Strategy

### Phase 1 — Single-region production (target: weeks)

1. **Provision GKE Standard** in `us-central1`, 3 × `e2-medium` nodes,
   auto-upgrade on the **Regular** channel, auto-repair enabled.
2. **Managed data services**:
   - Cloud SQL for PostgreSQL (Flexible/HA when load justifies), private IP
     via VPC peering to the cluster subnet.
   - Memorystore for Redis (Basic 1 GB initially; upgrade to Standard HA
     before exceeding the 99.9% availability SLO).
3. **Cluster services (Helm)**:
   - `ingress-nginx` for L7 ingress with WebSocket support.
   - `cert-manager` + Google Cloud DNS ACME solver for TLS (Let's Encrypt
     or Google-managed certs).
   - `kube-prometheus-stack` for metrics + alerting; ship logs to Cloud
     Logging via the GKE native integration.
   - `external-secrets` (optional) to bind GCP Secret Manager into K8s
     Secrets.
4. **Application manifests**:
   - `web-frontend` Deployment + Service (public via Ingress).
   - `collab-server` Deployment + Service (WebSocket; session affinity via
     NGINX `nginx.ingress.kubernetes.io/upstream-hash-by` cookie).
   - `backend-api` Deployment + Service (REST + SSE; HPA on CPU + custom
     metric for active SSE streams).
   - HorizontalPodAutoscalers on all three; Cluster Autoscaler on the node
     pool (min 3, max 10).
5. **TLS**: cert-manager issues a wildcard cert for `*.ribix.app` via
   Cloud DNS-01 challenge; auto-renewal enabled.
6. **CI/CD**: GitHub Actions builds images, pushes to Artifact Registry,
   and applies manifests via `kubectl`/Argo CD (CD tool TBD in a follow-up
   ADR). OIDC federation to GCP — no long-lived keys.
7. **Secrets**: all credentials (DB, Redis, AI provider keys) stored in
   GCP Secret Manager; mounted via external-secrets or Workload Identity.

### Phase 2 — Harden for SLO (target: months)

- Enable Cloud SQL HA (regional standby) once DAU > ~50.
- Upgrade Memorystore to Standard HA.
- Add Cloud CDN in front of the static frontend bundle.
- Add read replica for Postgres if read load grows.
- Define SLO-based alerting per `docs/slos.md`; wire Prometheus alerts to
  Cloud Monitoring + on-call (PagerDuty/Opsgenie).

### Phase 3 — Scale-out (target: 1,000 users)

- Move to multi-zonal node pools (already regional by default in GKE).
- Evaluate GKE Autopilot for the stateless services to drop node management.
- Consider a second region (`europe-west1`) with a global GLB and
  Memorystore/Cloud SQL cross-region replication for the collaboration tier.
- Re-evaluate provider at ~1,000 concurrent users against this ADR's
  "When to reconsider" criteria.

### Migration / exit path

Because Ingress, monitoring, and cert-manager are self-managed and the app
is containerized, moving to AWS or Azure entails:

1. Re-provision managed Postgres/Redis and restore from a logical backup.
2. Swap the GLB for an ALB/App Gateway and update Ingress annotations.
3. Re-point DNS.
4. Re-deploy identical Helm charts.

Estimated migration effort: 1–2 engineering days for a single-region
deployment, validating the low lock-in risk that informed this decision.

## References

- `docs/slos.md` — SLOs and error budgets this deployment must meet.
- `docs/production-secrets.md` — secrets handling policy.
- GKE pricing — https://cloud.google.com/kubernetes-engine/pricing
- EKS pricing — https://aws.amazon.com/eks/pricing/
- AKS pricing — https://azure.microsoft.com/pricing/details/kubernetes-service/
- Cloud SQL pricing — https://cloud.google.com/sql/pricing
- Memorystore pricing — https://cloud.google.com/memorystore/pricing
