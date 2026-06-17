# Mémos d'équipe — déploiement automatisé (Node.js conteneurisé)

Application web interne (Node.js + Express + PostgreSQL) déployée sur trois VM
KVM/libvirt, provisionnées par Terraform et configurées par Ansible, chaque
service tournant dans un conteneur Docker derrière un reverse proxy NGINX.

> Rapport complet du projet : [`rapport/rapport.pdf`](rapport/rapport.pdf)
> (source Markdown : [`rapport/rapport.md`](rapport/rapport.md)).

## Architecture en bref

| VM              | Rôle              | Conteneur          | IP privée   |
|-----------------|-------------------|--------------------|-------------|
| `reverse-proxy` | Point d'entrée TLS | NGINX (80/443)     | 10.10.0.10  |
| `app`           | Application        | Node.js + Express  | 10.10.0.20  |
| `db`            | Base de données   | PostgreSQL 16      | 10.10.0.30  |

Schéma : [`schema/architecture.png`](schema/architecture.png).

## Prérequis

- un hôte Linux avec KVM/libvirt et le démon `libvirtd` actif,
- Terraform (ou OpenTofu) >= 1.5 et le provider `dmacvicar/libvirt`,
- Ansible,
- une clé SSH (la clé publique sera injectée dans les VM).

## Déploiement

```bash
# 1. Infrastructure : VM, réseau privé NAT, cloud-init
cd terraform/
cp terraform.tfvars.example terraform.tfvars   # y renseigner sa clé SSH publique
terraform init
terraform apply

# 2. Configuration + déploiement des conteneurs (Docker, db, app, proxy)
cd ../ansible/
ansible-playbook site.yml
```

Accès une fois le playbook terminé : **https://10.10.0.10/** (certificat
auto-signé, l'avertissement du navigateur est normal). Le port 80 redirige
automatiquement vers le 443.

## Structure du dépôt

```
terraform/   IaC : VM, disques, réseau NAT, cloud-init
ansible/     provisioning, 4 rôles (common, database, app, reverse_proxy)
app/         application Node.js + Express et son Dockerfile
schema/      schéma d'architecture (architecture.png)
rapport/     rapport du projet (rapport.md + rapport.pdf)
```
