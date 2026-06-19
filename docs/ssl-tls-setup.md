# SSL / TLS Setup Guide — ribix-ide

This document describes how TLS/SSL is configured for the `ide.ribix.dev`
domain served by the ribix-ide Kubernetes deployment. It covers the
cert-manager + Let's Encrypt integration, installation, DNS configuration,
certificate verification, SSL testing, and the automatic renewal process.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [How cert-manager Works with Let's Encrypt](#how-cert-manager-works-with-lets-encrypt)
3. [Installing cert-manager](#installing-cert-manager)
4. [Configuring DNS for the Domain](#configuring-dns-for-the-domain)
5. [Applying the TLS Manifests](#applying-the-tls-manifests)
6. [Verifying the Certificate Is Issued](#verifying-the-certificate-is-issued)
7. [Testing the SSL Configuration](#testing-the-ssl-configuration)
8. [Certificate Renewal Process](#certificate-renewal-process)
9. [Troubleshooting](#troubleshooting)

---

## Architecture Overview

```
        Internet (HTTPS :443)
              |
              v
   +--------------------------+
   |  ingress-nginx controller|  <-- terminates TLS using cert from
   |  (LoadBalancer)          |      Secret `ribix-ide-tls`
   +--------------------------+
              |
              v
   +--------------------------+
   |  ribix-ide-web Service   |  (port 80 -> 3000)
   |  ribix-ide-websocket Svc|  (port 1234)
   +--------------------------+

   cert-manager (separate namespace)
     - watches Certificate resources
     - talks to Let's Encrypt ACME API
     - solves HTTP-01 challenge via ingress-nginx
     - stores cert+key in Secret `ribix-ide-tls`
```

The TLS-related Kubernetes resources live in:

- `web-ide/k8s/tls.yaml` — ClusterIssuers, Certificate, hardened Ingress,
  NetworkPolicy, PodSecurityPolicy.
- `web-ide/k8s/deployment.yaml` — the live Ingress (annotated with the same
  TLS hardening settings) and the application workloads.

---

## How cert-manager Works with Let's Encrypt

[cert-manager](https://cert-manager.io/) is a Kubernetes add-on that
automates the issuance and renewal of TLS certificates. It integrates with
[Let's Encrypt](https://letsencrypt.org/), a free, automated, and open
certificate authority that uses the **ACME** (RFC 8555) protocol.

### The issuance flow

1. **ClusterIssuer** — A cluster-scoped resource (`letsencrypt-prod` or
   `letsencrypt-staging`) that tells cert-manager which ACME server to talk
   to and which email to register with.

2. **Certificate request** — The `Certificate` resource
   (`ribix-ide-tls-cert`) declares the desired domain (`ide.ribix.dev`),
   the issuer to use, and the name of the Secret where the resulting
   certificate should be stored (`ribix-ide-tls`).

3. **Order & Challenge** — cert-manager creates an `Order` with Let's
   Encrypt. Let's Encrypt responds with a **challenge** to prove you
   control the domain. We use the **HTTP-01** challenge type: cert-manager
   tells the ingress controller to serve a one-time token at
   `http://ide.ribix.dev/.well-known/acme-challenge/<token>`.

4. **Challenge solved** — Let's Encrypt fetches the token over the public
   internet. If it matches, domain control is proven.

5. **Certificate issued** — Let's Encrypt signs the certificate.
   cert-manager stores the certificate, private key, and CA chain in the
   `ribix-ide-tls` Kubernetes Secret.

6. **Ingress uses the Secret** — The ingress-nginx controller reads the
   `ribix-ide-tls` Secret (referenced in the Ingress `tls` section) and
   uses it to terminate TLS on port 443.

### Production vs. staging

- **`letsencrypt-prod`** — issues real, browser-trusted certificates. Has
  strict [rate limits](https://letsencrypt.org/docs/rate-limits/).
- **`letsencrypt-staging`** — issues certificates from Let's Encrypt's
  staging environment. The certificates are **not** trusted by browsers
  but the issuance pipeline is identical and rate limits are very high.
  Use staging while testing, then switch the `issuerRef` (and the Ingress
  `cert-manager.io/cluster-issuer` annotation) to `letsencrypt-prod`.

---

## Installing cert-manager

cert-manager is installed independently of the ribix-ide manifests, usually
into its own namespace (`cert-manager`).

### Option A — Helm (recommended)

```bash
# Add the Jetstack Helm repository.
helm repo add jetstack https://charts.jetstack.io
helm repo update

# Install cert-manager with CRDs.
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager \
  --create-namespace \
  --set installCRDs=true \
  --set featureGates="AdditionalCertificateOutputFormats=true"
```

### Option B — kubectl apply (static manifests)

```bash
# Apply the cert-manager CRDs and controller.
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.14.4/cert-manager.yaml
```

### Verify the installation

```bash
kubectl get pods -n cert-manager
```

All three pods (`cert-manager`, `cert-manager-cainjector`,
`cert-manager-webhook`) should be `Running`:

```
NAME                                       READY   STATUS    RESTARTS   AGE
cert-manager-xxxxx-xxxxx                   1/1     Running   0          1m
cert-manager-cainjector-xxxxx-xxxxx        1/1     Running   0          1m
cert-manager-webhook-xxxxx-xxxxx           1/1     Running   0          1m
```

> **Important:** cert-manager must be installed **before** applying the
> `tls.yaml` manifest, otherwise the `ClusterIssuer` and `Certificate`
> custom resources will be rejected.

---

## Configuring DNS for the Domain

Let's Encrypt must be able to reach your ingress controller over the public
internet to solve the HTTP-01 challenge, and clients must resolve
`ide.ribix.dev` to your cluster's ingress.

### 1. Find the ingress controller LoadBalancer IP/hostname

```bash
kubectl get svc -n ingress-nginx
```

Look for the `ingress-nginx-controller` Service of type `LoadBalancer`:

```
NAME                       TYPE           CLUSTER-IP      EXTERNAL-IP      PORT(S)
ingress-nginx-controller   LoadBalancer   10.96.123.45    203.0.113.10     80:30080/TCP,443:30443/TCP
```

- On cloud providers (AWS, GCP, Azure) the `EXTERNAL-IP` will be a public
  IP or a DNS hostname.
- On bare-metal / on-prem clusters, use
  [MetalLB](https://metallb.universe.tf/) or an equivalent to assign a
  public IP.

### 2. Create DNS records

In your DNS provider (e.g. Cloudflare, Route53, Namecheap) for the
`ribix.dev` zone, create an **A record** (or CNAME):

| Type  | Name | Value          | TTL    |
|-------|------|----------------|--------|
| A     | ide  | 203.0.113.10   | 300    |
| A     | www  | 203.0.113.10   | 300    |

If your LoadBalancer exposes a hostname instead of an IP, create a CNAME:

| Type  | Name | Value                                   |
|-------|------|-----------------------------------------|
| CNAME | ide  | k8s-ingress-xxxx.elb.amazonaws.com      |

### 3. Verify DNS propagation

```bash
dig +short ide.ribix.dev
# or
nslookup ide.ribix.dev
```

The returned IP must match the ingress controller's `EXTERNAL-IP`. Use
[dnschecker.org](https://dnschecker.org/) to confirm global propagation
before requesting a certificate (Let's Encrypt validates from multiple
vantage points).

> **Tip:** Wait until DNS has fully propagated before applying the
> `Certificate` resource. If Let's Encrypt cannot resolve the domain, the
> challenge will fail and you may hit rate limits after repeated retries.

---

## Applying the TLS Manifests

Once cert-manager is installed and DNS is configured:

```bash
# From the repository root.
kubectl apply -f web-ide/k8s/deployment.yaml
kubectl apply -f web-ide/k8s/tls.yaml
```

> The Ingress is defined in both `deployment.yaml` and `tls.yaml` with
> identical TLS configuration. You only need to apply one of the two
> Ingress definitions — applying both is harmless (idempotent) but
> redundant. The `tls.yaml` version is the canonical, fully documented
> TLS-hardened Ingress.

---

## Verifying the Certificate Is Issued

### 1. Check the Certificate resource

```bash
kubectl get certificate -n ribix-ide
```

```
NAME                  READY   SECRET            AGE
ribix-ide-tls-cert    True    ribix-ide-tls     5m
```

`READY=True` means the certificate has been issued and stored in the
Secret. If it shows `False`, see [Troubleshooting](#troubleshooting).

### 2. Describe the Certificate for full status

```bash
kubectl describe certificate ribix-ide-tls-cert -n ribix-ide
```

Look at the `Status` section — it lists the conditions and the events
related to issuance.

### 3. Inspect the issued Secret

```bash
kubectl get secret ribix-ide-tls -n ribix-ide -o yaml
```

It should contain `tls.crt` (the certificate chain) and `tls.key` (the
private key).

### 4. Check the Order and Challenge resources

```bash
kubectl get orders -n ribix-ide
kubectl get challenges -n ribix-ide
```

A solved challenge shows `state: valid` / `status: True`.

### 5. Verify the ClusterIssuer is ready

```bash
kubectl get clusterissuer
```

```
NAME                  READY   AGE
letsencrypt-prod      True    10m
letsencrypt-staging   True    10m
```

---

## Testing the SSL Configuration

### 1. SSL Labs (external, comprehensive)

Open [https://www.ssllabs.com/ssltest/](https://www.ssllabs.com/ssltest/)
and enter `https://ide.ribix.dev`. Aim for an **A+** grade. The test
verifies:

- Certificate chain validity and trust.
- Protocol support (only TLS 1.2 / 1.3 should be accepted).
- Cipher suite strength.
- HSTS header presence and value.
- Forward secrecy and key exchange.

### 2. openssl — inspect the served certificate

```bash
# View the certificate chain, issuer, validity dates, and SANs.
openssl s_client -connect ide.ribix.dev:443 -servername ide.ribix.dev -showcerts </dev/null

# Print just the certificate details.
echo | openssl s_client -connect ide.ribix.dev:443 -servername ide.ribix.dev 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates -ext subjectAltName
```

Expected output should show:
- `issuer=C=US, O=Let's Encrypt, CN=R3` (or the current Let's Encrypt CA).
- `notBefore` / `notAfter` spanning ~90 days.
- `subjectAltName` containing `DNS:ide.ribix.dev`.

### 3. openssl — verify the chain

```bash
openssl s_client -connect ide.ribix.dev:443 -servername ide.ribix.dev </dev/null 2>/dev/null \
  | openssl verify -CAfile <(echo | openssl s_client -connect ide.ribix.dev:443 -showcerts 2>/dev/null \
  | sed -n '/BEGIN CERT/,/END CERT/p')
```

### 4. Test supported protocols (reject legacy TLS)

```bash
# Should FAIL (TLS 1.0 disabled).
openssl s_client -connect ide.ribix.dev:443 -tls1 </dev/null 2>&1 | grep -i protocol

# Should FAIL (TLS 1.1 disabled).
openssl s_client -connect ide.ribix.dev:443 -tls1_1 </dev/null 2>&1 | grep -i protocol

# Should SUCCEED (TLS 1.2).
openssl s_client -connect ide.ribix.dev:443 -tls1_2 </dev/null 2>&1 | grep -i protocol

# Should SUCCEED (TLS 1.3).
openssl s_client -connect ide.ribix.dev:443 -tls1_3 </dev/null 2>&1 | grep -i protocol
```

### 5. Test the HTTP -> HTTPS redirect

```bash
curl -I http://ide.ribix.dev
```

Expected: `301 Moved Permanently` with a `Location: https://ide.ribix.dev/`
header.

### 6. Verify HSTS header

```bash
curl -sI https://ide.ribix.dev | grep -i strict-transport-security
```

Expected:

```
strict-transport-security: max-age=31536000; includeSubDomains; preload
```

### 7. Test a specific cipher

```bash
# Should succeed (a modern ECDHE-AES256-GCM cipher).
openssl s_client -connect ide.ribix.dev:443 -servername ide.ribix.dev \
  -cipher 'ECDHE-RSA-AES256-GCM-SHA384' </dev/null 2>&1 | grep -i 'Cipher'

# Should fail (a legacy CBC cipher).
openssl s_client -connect ide.ribix.dev:443 -servername ide.ribix.dev \
  -cipher 'AES256-SHA' </dev/null 2>&1 | grep -i 'Cipher'
```

---

## Certificate Renewal Process

### Automatic renewal (cert-manager)

Renewal is **fully automatic** — no manual intervention is required.

- The `Certificate` resource in `tls.yaml` specifies:
  - `duration: 2160h` (90 days — the Let's Encrypt maximum).
  - `renewBefore: 360h` (renew 15 days before expiry).
- cert-manager continuously checks all `Certificate` resources. When a
  certificate is within the `renewBefore` window of its expiry, cert-manager
  automatically creates a new ACME `Order`, solves the HTTP-01 challenge
  again, and **atomically updates** the `ribix-ide-tls` Secret with the new
  certificate and key.
- ingress-nginx watches the Secret and **hot-reloads** the new certificate
  without restarting pods or dropping active connections.

### Monitoring renewal

```bash
# Check the renewal window and current expiry.
kubectl describe certificate ribix-ide-tls-cert -n ribix-ide | grep -A5 Status
```

Set up alerts on the `certmanager_certificate_expiration_timestamp_seconds`
Prometheus metric (exposed by cert-manager) to be notified if a certificate
is close to expiry and has not yet renewed.

### Forcing a manual renewal

If you ever need to force renewal (e.g. after a key compromise):

```bash
# Delete the Secret — cert-manager will re-issue immediately.
kubectl delete secret ribix-ide-tls -n ribix-ide

# Or trigger a re-issue by deleting the Certificate and re-applying.
kubectl delete certificate ribix-ide-tls-cert -n ribix-ide
kubectl apply -f web-ide/k8s/tls.yaml
```

### Rate limit awareness

Let's Encrypt enforces [rate limits](https://letsencrypt.org/docs/rate-limits/):
- 50 certificates per registered domain per week.
- 5 duplicate certificates per week.
- 5 failed validations per account per hostname per hour.

Because renewals only happen close to expiry and use the same order, they
count as normal renewals (not duplicates) and stay well within limits.

---

## Troubleshooting

### Certificate stuck in `READY=False`

```bash
kubectl describe certificate ribix-ide-tls-cert -n ribix-ide
kubectl describe challenge -n ribix-ide
kubectl logs -n cert-manager -l app.kubernetes.io/instance=cert-manager --tail=50
```

Common causes:

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Failed to determine the order` | ClusterIssuer not Ready | `kubectl get clusterissuer`; check ACME email/URL. |
| Challenge `http-01` fails | DNS not pointing to ingress, or port 80 blocked | Verify `dig ide.ribix.dev` and that port 80 is reachable. |
| `429 Too Many Requests` | Let's Encrypt rate limit hit | Use `letsencrypt-staging` to debug; wait for limit window to pass. |
| Secret never created | Wrong `secretName` / namespace mismatch | Ensure `Certificate.secretName` matches the Ingress `tls.secretName`. |

### Ingress not serving the certificate

- Confirm the Ingress `tls.hosts` includes `ide.ribix.dev`.
- Confirm `tls.secretName: ribix-ide-tls` matches the Certificate's
  `secretName`.
- Confirm the ingress class annotation matches your controller (`nginx`).
- Check the ingress controller logs:
  `kubectl logs -n ingress-nginx -l app.kubernetes.io/name=ingress-nginx`.

### HSTS / redirect not working

- Confirm the `nginx.ingress.kubernetes.io/ssl-redirect: "true"` and
  `hsts` annotations are present on the Ingress:
  `kubectl get ingress -n ribix-ide -o yaml`.
- Reload the ingress controller config if needed:
  `kubectl rollout restart deployment/ingress-nginx-controller -n ingress-nginx`.
