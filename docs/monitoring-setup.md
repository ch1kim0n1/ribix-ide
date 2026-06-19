# Ribix IDE — Monitoring & Alerting Setup

This document describes how to deploy and operate the monitoring and alerting
stack for the ribix-ide Kubernetes deployment.

The stack lives in two manifests:

| File | Contents |
|------|----------|
| `web-ide/k8s/monitoring.yaml` | Namespace, Prometheus, Grafana, Alertmanager, ServiceMonitors, PodMonitor, dashboard ConfigMap, NetworkPolicy |
| `web-ide/k8s/alerting-rules.yaml` | Prometheus alerting rules (ConfigMap + PrometheusRule CRD) |

The monitored application is defined in `web-ide/k8s/deployment.yaml`:

- Namespace: `ribix-ide`
- `ribix-ide-web` — 3 replicas, port 3000, exposes `/health` and `/metrics`
- `ribix-ide-websocket` — 2 replicas, ports 1234 (WS) and 1235 (metrics/health), exposes `/health` and `/metrics`
- Ingress: `ide.ribix.dev` with TLS secret `ribix-ide-tls` (cert-manager)

---

## 1. Prerequisites

1. A running Kubernetes cluster with the `ribix-ide` namespace deployed:
   ```bash
   kubectl apply -f web-ide/k8s/deployment.yaml
   ```
2. **Recommended:** the Prometheus Operator CRDs (`ServiceMonitor`,
   `PodMonitor`, `PrometheusRule`). Install via kube-prometheus-stack:
   ```bash
   helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
   helm install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
     --namespace monitoring --create-namespace
   ```
   If you use the Helm chart, you can skip the standalone Prometheus/Grafana
   deployments in `monitoring.yaml` and only apply the ServiceMonitors,
   PodMonitor, PrometheusRule, dashboard ConfigMap, and NetworkPolicy.

3. **Standalone (no operator):** the manifests in `monitoring.yaml` deploy
   Prometheus, Grafana, and Alertmanager directly. The Prometheus Operator
   CRDs are still required for the `ServiceMonitor`/`PodMonitor`/`PrometheusRule`
   objects — install the bare CRDs if you don't want the full Helm chart:
   ```bash
   kubectl apply --server-side -f https://raw.githubusercontent.com/prometheus-operator/prometheus-operator/main/bundle.yaml
   ```

4. Supporting exporters (recommended for the alert rules to fire correctly):
   - **kube-state-metrics** — provides `kube_pod_container_status_restarts_total`,
     `kube_pod_status_ready`, `kube_pod_container_resource_limits`.
   - **node-exporter** — provides `node_filesystem_*` metrics for `DiskPressure`.
   - **cert-manager** — provides `certmanager_certificate_expiration_timestamp_seconds`.
   - **nginx ingress controller metrics** — exposed on port 10254 by default.

---

## 2. Deploy the Monitoring Stack

```bash
# From the repo root
kubectl apply -f web-ide/k8s/monitoring.yaml
kubectl apply -f web-ide/k8s/alerting-rules.yaml
```

Verify everything is running:

```bash
kubectl -n ribix-monitoring get pods
kubectl -n ribix-monitoring get svc
```

Expected pods: `prometheus`, `grafana`, `alertmanager` (each 1/1 Running).

Check that Prometheus has targets:

```bash
kubectl -n ribix-monitoring port-forward svc/prometheus 9090:9090
# open http://localhost:9090/targets
```

You should see `ribix-ide-web` and `ribix-ide-websocket` jobs in the **UP** state.

---

## 3. Accessing Grafana

### Port-forward

```bash
kubectl -n ribix-monitoring port-forward svc/grafana 3000:80
```

Then open **http://localhost:3000** in your browser.

### Default credentials

The credentials are stored in the `grafana-admin-secret` Secret in the
`ribix-monitoring` namespace:

| Field | Default value |
|-------|---------------|
| Username | `admin` |
| Password | `ribix-grafana-admin` |

**Change the password before exposing Grafana outside the cluster.** Update the
Secret or, better, inject the password from an external secret manager
(Sealed Secrets, External Secrets, Vault):

```bash
kubectl -n ribix-monitoring create secret generic grafana-admin-secret \
  --from-literal=admin-user=admin \
  --from-literal=admin-password="$(openssl rand -base64 24)" \
  --dry-run=client -o yaml | kubectl apply -f -
```

Then restart Grafana:

```bash
kubectl -n ribix-monitoring rollout restart deployment/grafana
```

### Pre-provisioned datasource & dashboard

The Grafana pod is configured (via the `grafana-config` ConfigMap) with:

- **Prometheus** datasource pointing at `http://prometheus:9090` (default).
- **Alertmanager** datasource pointing at `http://alertmanager:9093`.
- A dashboard provider that loads any JSON in `/var/lib/grafana/dashboards`.

The **Ribix IDE Health** dashboard (`grafana-dashboard-ide-health` ConfigMap)
is mounted into that directory and appears automatically under the
**Ribix IDE** folder.

---

## 4. Configuring Alert Notifications

Alertmanager routes alerts to receivers. The default config
(`alertmanager-config` ConfigMap) defines four receivers:
`default`, `slack`, `email`, and `pagerduty`.

Routing logic:

| Severity / alert | Receiver |
|------------------|----------|
| `severity=critical` | `pagerduty` |
| `severity=warning` | `slack` |
| `CertificateExpiringSoon`, `IngressBackendErrors` | `email` |
| everything else | `default` |

After editing the config, reload Alertmanager:

```bash
kubectl -n ribix-monitoring rollout restart deployment/alertmanager
# or trigger a hot reload:
kubectl -n ribix-monitoring port-forward svc/alertmanager 9093:9093
curl -X POST http://localhost:9093/-/reload
```

### 4.1 Slack

1. Create an incoming webhook in Slack:
   **Apps → Manage → Custom Integrations → Incoming WebHooks**.
2. Pick the channel (e.g. `#ribix-alerts`).
3. Edit the `alertmanager-config` ConfigMap and replace the placeholder:

   ```yaml
   slack_configs:
     - api_url: "https://YOUR-SLACK-WEBHOOK-URL"
       channel: "#ribix-alerts"
       send_resolved: true
   ```

   For security, store the webhook URL in a Secret and reference it via an
   env var that Alertmanager reads, or use a tool like
   [alertmanager-templates](https://prometheus.io/docs/alerting/latest/configuration/).

### 4.2 Email (SMTP)

Edit the `email` receiver in the ConfigMap:

```yaml
email_configs:
  - to: "oncall@ribix.dev"
    from: "alertmanager@ribix.dev"
    smarthost: "smtp.ribix.dev:587"
    auth_username: "alertmanager@ribix.dev"
    auth_password: "REPLACE_ME"      # use a Secret in production
    require_tls: true
    send_resolved: true
```

For Gmail / Office365, use an app-specific password, not your account password.

### 4.3 PagerDuty

PagerDuty uses the Events API v2. The bundled `pagerduty` receiver posts to
`https://events.pagerduty.com/v2/enqueue`. To wire it up properly:

1. In PagerDuty, create a **Services → New Service → Events API v2**.
2. Copy the **Integration Key** (a 32-char string).
3. Replace the webhook receiver with a `pagerduty_configs` block:

   ```yaml
   - name: "pagerduty"
     pagerduty_configs:
       - routing_key: "YOUR_INTEGRATION_KEY"
         severity: "{{ .CommonLabels.severity }}"
         send_resolved: true
   ```

   Store the routing key in a Secret rather than the ConfigMap for production.

### 4.4 Testing alerts

Send a test alert to Alertmanager:

```bash
kubectl -n ribix-monitoring port-forward svc/alertmanager 9093:9093
curl -X POST http://localhost:9093/api/v2/alerts \
  -H "Content-Type: application/json" \
  -d '[{
    "labels": {
      "alertname": "TestAlert",
      "severity": "warning",
      "namespace": "ribix-ide"
    },
    "annotations": {
      "summary": "Test alert",
      "description": "Verifying Alertmanager routing"
    }
  }]'
```

You should see the alert in the Alertmanager UI (`http://localhost:9093`) and
in the configured receiver (Slack channel, inbox, PagerDuty incident).

---

## 5. Grafana Dashboards

### Ribix IDE Health (`ribix-ide-health`)

Auto-provisioned from the `grafana-dashboard-ide-health` ConfigMap. Panels:

| # | Panel | Metric | Purpose |
|---|-------|--------|---------|
| 1 | HTTP Request Rate | `rate(http_requests_total[1m])` | Live requests/sec |
| 2 | HTTP Error Rate (5xx %) | 5xx / total × 100 | SLO error budget burn |
| 3 | Request Latency p95 / p99 | `histogram_quantile` on `http_request_duration_seconds_bucket` | Tail latency |
| 4 | WebSocket Active Connections | `websocket_connections_active` by pod | Collaboration load |
| 5 | WebSocket Health Check Status | `up{job="ribix-ide-websocket"}` | Endpoint reachability |
| 6 | Pod CPU Usage | `container_cpu_usage_seconds_total` by pod | Capacity planning |
| 7 | Pod Memory Usage | `container_memory_working_set_bytes` by pod | Memory pressure |
| 8 | Pod Restarts (1h) | `increase(kube_pod_container_status_restarts_total[1h])` | Stability |
| 9 | Pod Ready Status | `kube_pod_status_ready` | Availability |
| 10 | Node Disk Usage (%) | `node_filesystem_*` | Disk pressure |

The dashboard supports template variables `$namespace` and `$pod` for drilling
into individual pods.

### Adding more dashboards

1. Build the dashboard in Grafana's UI.
2. Export → **View JSON**.
3. Save the JSON into a new ConfigMap with label `grafana_dashboard: "1"`:

   ```bash
   kubectl -n ribix-monitoring create configmap grafana-dashboard-my-panel \
     --from-file=my-panel.json=./my-panel.json \
     --dry-run=client -o yaml | \
     kubectl label --local -f - grafana_dashboard=1 -o yaml | kubectl apply -f -
   ```

4. Mount it into Grafana's `/var/lib/grafana/dashboards` directory (extend the
   `grafana` Deployment volumes), or rely on a sidecar dashboard importer.

---

## 6. Alert Rules

All rules are defined in `web-ide/k8s/alerting-rules.yaml`, both as a ConfigMap
(`prometheus-rules`, mounted into standalone Prometheus) and as a
`PrometheusRule` CRD (`ribix-ide-alerts`, picked up by the operator).

| Alert | Severity | Condition | For | Purpose |
|-------|----------|-----------|-----|---------|
| `HighErrorRate` | critical | 5xx / total > 5% | 5m | User-visible failures |
| `HighLatency` | warning | p95 > 2s | 5m | Slow IDE responses |
| `PodCrashLooping` | critical | restarts > 3 in 10m | 0m | Unstable pods |
| `HighCPUUsage` | warning | CPU > 80% of limit | 10m | Capacity exhaustion |
| `HighMemoryUsage` | warning | Memory > 85% of limit | 10m | OOM risk |
| `WebSocketServerDown` | critical | `up` == 0 | 2m | Collaboration outage |
| `CertificateExpiringSoon` | warning | cert < 14d to expiry | 10m | TLS renewal |
| `IngressBackendErrors` | warning | ingress 5xx > 1% | 5m | Edge failures |
| `DiskPressure` | warning | node disk > 85% | 5m | Node health |
| `PodNotReady` | critical | not Ready | 5m | Availability |

Each alert carries a `runbook_url` annotation pointing back to this document.

---

## 7. Runbooks

### HighErrorRate

**Symptom:** More than 5% of HTTP responses to `ribix-ide-web` are 5xx for 5
minutes.

1. Open Grafana → **Ribix IDE Health** → check the **HTTP Error Rate** and
   **Request Latency** panels. Identify the failing pod via the `$pod`
   variable.
2. Check pod logs:
   ```bash
   kubectl -n ribix-ide logs -l app=ribix-ide-web --tail=200 --previous
   ```
3. Check downstream dependencies (Postgres, Redis) are reachable:
   ```bash
   kubectl -n ribix-ide exec deploy/ribix-ide-web -- \
     sh -c 'nc -zv postgres 5432; nc -zv redis 6379'
   ```
4. If a single pod is failing, restart it:
   ```bash
   kubectl -n ribix-ide delete pod <pod-name>
   ```
5. If all pods fail, roll back the last deployment:
   ```bash
   kubectl -n ribix-ide rollout undo deployment/ribix-ide-web
   ```

### HighLatency

**Symptom:** p95 request latency exceeds 2s for 5 minutes.

1. Check the **Pod CPU** and **Pod Memory** panels — resource saturation is the
   most common cause.
2. Check the HPA:
   ```bash
   kubectl -n ribix-ide get hpa ribix-ide-web-hpa
   ```
   If replicas are maxed (10), the cluster may need more nodes.
3. Inspect slow queries / DB load:
   ```bash
   kubectl -n ribix-ide exec deploy/postgres -- psql -U user -d ribix -c \
     "SELECT query, mean_exec_time FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;"
   ```
4. Consider raising the HPA `maxReplicas` or the per-pod CPU/memory limits.

### PodCrashLooping

**Symptom:** A container restarted more than 3 times in 10 minutes.

1. Get the pod name from the alert's `pod` label.
2. Inspect events and previous logs:
   ```bash
   kubectl -n ribix-ide describe pod <pod-name>
   kubectl -n ribix-ide logs <pod-name> --previous --tail=100
   ```
3. Common causes: OOMKilled (raise memory limit), CrashLoopBackOff from a bad
   config/secret (verify ConfigMap & Secret keys), failed migrations.
4. If a bad rollout caused it, undo:
   ```bash
   kubectl -n ribix-ide rollout undo deployment/<deployment-name>
   ```

### HighCPUUsage

**Symptom:** A pod's CPU exceeds 80% of its limit for 10 minutes.

1. Confirm in Grafana → **Pod CPU Usage** panel.
2. If sustained, the HPA should already be scaling. Verify:
   ```bash
   kubectl -n ribix-ide get hpa
   ```
3. If HPA is idle, check that the pod exposes CPU metrics and that
   `kube_pod_container_resource_limits` exists for the pod.
4. Increase `maxReplicas` or the container CPU limit in `deployment.yaml`.

### HighMemoryUsage

**Symptom:** A pod's memory exceeds 85% of its limit for 10 minutes.

1. Confirm in Grafana → **Pod Memory Usage** panel.
2. Watch for OOMKills:
   ```bash
   kubectl -n ribix-ide get events --field-selector reason=OOMKilling
   ```
3. Raise the memory `limit` in `deployment.yaml` and roll out:
   ```bash
   kubectl -n ribix-ide rollout restart deployment/<deployment-name>
   ```
4. Investigate memory leaks in the application (heap snapshots, Node.js
   `--inspect`).

### WebSocketServerDown

**Symptom:** The `ribix-ide-websocket` `/health` endpoint has been unreachable
for 2 minutes.

1. Check the pod directly:
   ```bash
   kubectl -n ribix-ide get pods -l app=ribix-ide-websocket
   kubectl -n ribix-ide describe pod -l app=ribix-ide-websocket
   ```
2. Port-forward and curl health:
   ```bash
   kubectl -n ribix-ide port-forward svc/ribix-ide-websocket 1235:1234
   curl http://localhost:1235/health
   ```
3. Check Redis connectivity (the WS server depends on Redis for pub/sub):
   ```bash
   kubectl -n ribix-ide exec deploy/ribix-ide-websocket -- \
     sh -c 'nc -zv redis 6379'
   ```
4. Restart the deployment if needed:
   ```bash
   kubectl -n ribix-ide rollout restart deployment/ribix-ide-websocket
   ```

### CertificateExpiringSoon

**Symptom:** The TLS certificate for `ide.ribix.dev` (secret `ribix-ide-tls`)
expires in under 14 days.

1. Check cert-manager:
   ```bash
   kubectl -n ribix-ide get certificate
   kubectl -n ribix-ide describe certificate ribix-ide-tls
   ```
2. Check the cluster-issuer:
   ```bash
   kubectl get clusterissuer letsencrypt-prod
   ```
3. Common fixes: rate-limit hits with Let's Encrypt, missing DNS-01/HTTP-01
   solver, expired issuer credentials. Force a renewal:
   ```bash
   kubectl -n ribix-ide delete secret ribix-ide-tls
   # cert-manager will reissue
   ```

### IngressBackendErrors

**Symptom:** The nginx ingress controller returns >1% 5xx for ribix-ide
backends over 5 minutes.

1. Check ingress controller logs:
   ```bash
   kubectl -n ingress-nginx logs -l app.kubernetes.io/name=ingress-nginx --tail=200
   ```
2. Confirm backends are healthy (see `HighErrorRate` runbook).
3. Check for `502`/`503` which indicate the ingress can't reach the service:
   ```bash
   kubectl -n ribix-ide get endpoints ribix-ide-web
   ```
   If endpoints are empty, the Service selector doesn't match any pods.

### DiskPressure

**Symptom:** A node filesystem is >85% full for 5 minutes.

1. Identify the node and mount point from the alert labels.
2. SSH to the node (or use a debug pod) and check usage:
   ```bash
   df -h
   ```
3. Common culprits: old container images, logs, Prometheus/Alertmanager data.
   Prune images:
   ```bash
   crictl rmi --prune
   ```
4. If the Prometheus PVC is the cause, increase its size or lower
   `--storage.tsdb.retention.time`.
5. Consider cordoning and draining the node if it can't be cleaned in place.

### PodNotReady

**Symptom:** A pod in `ribix-ide` has not been Ready for 5 minutes.

1. Identify the pod from the alert label.
2. Describe it and read events:
   ```bash
   kubectl -n ribix-ide describe pod <pod-name>
   kubectl -n ribix-ide get events --field-selector involvedObject.name=<pod-name>
   ```
3. Common causes: failing readiness probe (see `HighErrorRate`), image pull
   errors, pending PVCs, unschedulable pods (insufficient node resources).
4. Delete the pod to force rescheduling if the node is bad:
   ```bash
   kubectl -n ribix-ide delete pod <pod-name>
   ```

---

## 8. Maintenance

### Retention

Prometheus retains 15 days of data by default
(`--storage.tsdb.retention.time=15d`). Increase the `prometheus-data` PVC
(20 Gi default) if you extend retention.

### Upgrading

```bash
# Edit the image tags in monitoring.yaml, then:
kubectl apply -f web-ide/k8s/monitoring.yaml
kubectl -n ribix-monitoring rollout restart deployment/prometheus
kubectl -n ribix-monitoring rollout restart deployment/grafana
kubectl -n ribix-monitoring rollout restart deployment/alertmanager
```

### Removing the stack

```bash
kubectl delete -f web-ide/k8s/alerting-rules.yaml
kubectl delete -f web-ide/k8s/monitoring.yaml
kubectl delete namespace ribix-monitoring
```

> Note: deleting the namespace also removes the Prometheus and Grafana PVCs
> and all stored metrics/dashboards. Back up dashboards first if needed.
