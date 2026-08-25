# Agri-Fi GitOps with ArgoCD

This repository follows the GitOps pattern using ArgoCD for Kubernetes deployment automation.

## Architecture

1. **Git Repository as Source of Truth**: All Kubernetes manifests live in `devops/k8s/`.
2. **CI Pipeline**: On push to `main`, GitHub Actions builds container images, updates the image tag in `devops/k8s/`, and commits back to the repo.
3. **ArgoCD Controller**: Detects git commits, compares cluster live state against the Git manifest, and synchronizes state.
4. **Secrets Management**: Managed via Bitnami Sealed Secrets (`devops/k8s/argocd/sealed-secrets.yaml`) or External Secrets Operator.

## Automated Rollback Procedure

To roll back a bad deployment:
```bash
git revert HEAD
git push origin main
```
ArgoCD detects the revert commit and automatically transitions the Kubernetes cluster back to the previous stable state.
