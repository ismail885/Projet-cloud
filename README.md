# Déploiement automatisé d'une application web conteneurisée

**Module Cloud Computing — École Hexagone (B3)**
*Infrastructure virtualisée, reproductible et automatisée pour l'hébergement d'une application interne*

Ce document tient lieu de rapport de projet : il décrit l'intégralité de la
solution, du contexte aux choix techniques, et sert également de guide de
déploiement. Le dépôt contient tout le code nécessaire pour reconstruire
l'environnement de zéro en deux commandes.

---

## 1. Introduction et contexte

Une PME exploite une application web interne — un outil de **mémos d'équipe**
(petites notes partagées entre collègues) — historiquement installée à la main
sur un serveur unique. Cette approche pose trois problèmes concrets : les
déploiements ne sont pas reproductibles, la moindre opération de maintenance est
risquée, et il n'existe aucune séparation entre les composants (front, applicatif,
données cohabitent sur la même machine).

L'objectif du projet est de moderniser cet hébergement en s'appuyant sur quatre
piliers vus en cours : la **virtualisation**, la **conteneurisation**,
l'**Infrastructure as Code** et l'**automatisation du déploiement**. Le résultat
doit être une infrastructure simple mais entièrement reproductible : on doit
pouvoir la détruire et la recréer à l'identique sans intervention manuelle.

L'application choisie est volontairement modeste (Node.js + Express + PostgreSQL)
afin de concentrer l'effort sur l'infrastructure et l'automatisation plutôt que
sur le code métier.

## 2. Présentation de l'architecture

La solution répartit les responsabilités sur **trois machines virtuelles**, chacune
dédiée à un rôle, conformément au principe de séparation des préoccupations.

![Schéma d'architecture](schema/architecture.png)

| VM              | Rôle                       | Logiciel (conteneur)      | IP privée    | Ports        |
|-----------------|----------------------------|---------------------------|--------------|--------------|
| `reverse-proxy` | Point d'entrée / TLS        | NGINX                     | 10.10.0.10   | 80, 443      |
| `app`           | Application web             | Node.js + Express         | 10.10.0.20   | 8000 (privé) |
| `db`            | Base de données            | PostgreSQL 16             | 10.10.0.30   | 5432 (privé) |

Le **client** (navigateur) ne dialogue qu'avec le reverse proxy. Ni l'application
ni la base ne sont exposées à l'extérieur : elles ne sont joignables que sur le
réseau privé `10.10.0.0/24`. Cette topologie reproduit à petite échelle le
découpage classique d'une infrastructure web (zone publique / zone applicative /
zone données).

## 3. Description de l'infrastructure virtualisée

L'hyperviseur retenu est **KVM/libvirt**, solution de virtualisation open source
intégrée au noyau Linux. Les trois VM sont des invités Debian 12 (« Bookworm »)
issus d'une **image cloud** officielle, ce qui évite toute installation manuelle
de système.

Toute l'infrastructure est décrite en **Terraform** (provider
`dmacvicar/libvirt`), dans le dossier `terraform/` :

- un **pool de stockage** dédié ;
- une **image de base** Debian téléchargée une seule fois, dont chaque VM dérive
  son disque (mécanisme de *backing store*, économe en espace) ;
- un **réseau privé NAT** `10.10.0.0/24` ;
- un disque **cloud-init** par VM, qui injecte le nom d'hôte, l'utilisateur
  `cloud`, la clé SSH publique et l'adresse IP fixe ;
- les trois **domaines** (VM) eux-mêmes, paramétrés via une simple `map` :

```hcl
variable "vms" {
  type = map(object({ ip = string }))
  default = {
    "reverse-proxy" = { ip = "10.10.0.10" }
    "app"           = { ip = "10.10.0.20" }
    "db"            = { ip = "10.10.0.30" }
  }
}
```

Ajouter ou renommer une VM revient donc à modifier cette seule structure :
Terraform recrée automatiquement disque, cloud-init et domaine via `for_each`.
L'environnement est ainsi **idempotent et reproductible** : `terraform destroy`
puis `terraform apply` reconstruit un état identique.

## 4. Déploiement automatisé (provisioning)

Une fois les VM démarrées par Terraform, la configuration est prise en charge par
**Ansible** (`ansible/`), choisi pour son fonctionnement *agentless* (pilotage par
SSH, sans installation préalable sur les cibles) et son **idempotence**.

Le playbook `site.yml` orchestre quatre étapes, dans un ordre qui respecte les
dépendances (la base avant l'application, l'application avant le proxy) :

1. **rôle `common`** *(sur toutes les VM)* — installation de Docker Engine et du
   plugin Compose depuis le dépôt officiel Docker.
2. **rôle `database`** — déploiement du conteneur PostgreSQL avec un volume
   persistant et un *healthcheck*.
3. **rôle `app`** — copie du code, *build* de l'image applicative et démarrage du
   conteneur.
4. **rôle `reverse_proxy`** — génération d'un certificat TLS auto-signé,
   configuration NGINX et démarrage du conteneur.

L'inventaire (`inventory.ini`) associe chaque groupe d'hôtes à son IP. Le
déploiement complet tient donc en une seule commande, et peut être relancé sans
effet de bord.

## 5. Conteneurisation

Chaque service tourne dans son propre **conteneur Docker**, piloté par un fichier
`docker-compose` distinct sur chaque VM.

L'application est packagée via un `Dockerfile` multi-couches qui sépare
l'installation des dépendances du code (pour profiter du cache de build) et
exécute le processus sous un utilisateur non privilégié :

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
EXPOSE 8000
USER node
CMD ["node", "server.js"]
```

La connexion à la base est entièrement paramétrée par **variables
d'environnement** injectées par Compose (`DB_HOST`, `DB_USER`, …), si bien que la
même image fonctionne quel que soit l'environnement. L'application attend
activement que PostgreSQL réponde avant de démarrer et expose un *endpoint*
`/health` exploitable pour la supervision.

## 6. Réseau et accès

**Plan d'adressage** — réseau privé NAT `10.10.0.0/24`, passerelle `10.10.0.1`,
adresses fixes attribuées par cloud-init (`.10`, `.20`, `.30`).

**Flux réseau :**

```
Client ─HTTPS:443─▶ NGINX (10.10.0.10) ─HTTP:8000─▶ App (10.10.0.20) ─TCP:5432─▶ PostgreSQL (10.10.0.30)
```

- Le trafic **HTTP (port 80)** est systématiquement redirigé vers **HTTPS (443)**
  par une règle `return 301`.
- Le reverse proxy termine le **TLS** (certificat auto-signé, bonus HTTPS) et relaie
  les requêtes vers l'application en transmettant les en-têtes `X-Forwarded-*`.
- L'application et la base **n'exposent leurs ports que sur le réseau privé**
  (binding sur l'IP interne), elles sont donc inaccessibles depuis l'extérieur.

**Rôle du reverse proxy :** il constitue l'unique point d'entrée. Il centralise la
terminaison TLS, masque la topologie interne, et permettrait à terme d'ajouter de
la répartition de charge, du cache ou un pare-feu applicatif sans toucher à
l'application.

## 7. Analyse et justification des choix techniques

**Choix des technologies.** KVM/libvirt, Terraform, Ansible, Docker et NGINX sont
tous **open source**, largement documentés et représentatifs des standards de
l'industrie — ce qui correspond à la recommandation du sujet. Node.js/Express a
été préféré à une pile plus lourde car l'application de démonstration reste
légère et le démarrage est rapide.

**Découpage de l'architecture.** Séparer proxy, application et base sur trois VM
isole les responsabilités, limite la surface d'exposition (seul le proxy est
public) et permet de faire évoluer ou redémarrer un service sans impacter les
autres.

**Avantages de la conteneurisation.** Les images embarquent leurs dépendances :
le comportement est identique en local et en production, le déploiement est
portable, et un service peut être recréé en quelques secondes. Le découplage
applicatif/runtime simplifie aussi les mises à jour.

**Avantages de l'automatisation.** Terraform + Ansible rendent l'infrastructure
**reproductible et versionnée** : tout est décrit dans le dépôt, recréable à
l'identique, et tracé par Git. La reprise après incident se résume à relancer le
pipeline.

**Limites de la solution.** L'infrastructure reste mono-hôte : l'hyperviseur est
un point de défaillance unique (pas de haute disponibilité). Le certificat TLS est
auto-signé (avertissement navigateur). Le mot de passe de base figure en clair
dans les variables Ansible (à externaliser via Ansible Vault en production). Enfin,
il n'y a ni sauvegarde automatisée ni supervision centralisée — ce sont des axes
d'amélioration identifiés ci-dessous.

## 8. Conclusion

Le projet démontre une chaîne complète et cohérente : Terraform provisionne une
infrastructure virtualisée reproductible, Ansible la configure de façon idempotente,
et Docker isole chaque service derrière un reverse proxy. La solution reste
volontairement simple, mais elle illustre concrètement les principes du Cloud
Computing — virtualisation, IaC, conteneurisation et automatisation — et peut être
reconstruite intégralement en deux commandes. Les pistes d'évolution naturelles
sont la haute disponibilité, les sauvegardes, la supervision et une intégration
continue.

---

## Déploiement

```bash
# 1. Infrastructure (VMs, réseau, cloud-init)
cd terraform/
cp terraform.tfvars.example terraform.tfvars   # y mettre sa clé SSH publique
terraform init && terraform apply

# 2. Configuration + déploiement des conteneurs
cd ../ansible/
ansible-playbook site.yml

# 3. Accès : https://10.10.0.10/   (certificat auto-signé)
```

## Arborescence

- `terraform/` — IaC : VM, disques, réseau NAT, cloud-init
- `ansible/`   — provisioning, 4 rôles (`common`, `database`, `app`, `reverse_proxy`)
- `app/`       — application Node.js + Express et son `Dockerfile`
- `schema/`    — schéma d'architecture (`architecture.png`)

## Pistes bonus

HTTPS (déjà en place via certificat auto-signé) · supervision (endpoint `/health`)
· sauvegardes du volume PostgreSQL · haute disponibilité · intégration continue.
