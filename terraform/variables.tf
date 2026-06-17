variable "libvirt_uri" {
  description = "URI de connexion à l'hyperviseur KVM/libvirt"
  type        = string
  default     = "qemu:///system"
}

variable "pool_name" {
  description = "Nom du pool de stockage libvirt"
  type        = string
  default     = "cloud-pool"
}

variable "pool_path" {
  description = "Chemin disque du pool de stockage"
  type        = string
  default     = "/var/lib/libvirt/cloud-pool"
}

variable "base_image_url" {
  description = "Image cloud de base (Debian 12 generic cloud, qcow2)"
  type        = string
  default     = "https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-genericcloud-amd64.qcow2"
}

variable "network_cidr" {
  description = "Plage d'adressage du réseau privé NAT"
  type        = string
  default     = "10.10.0.0/24"
}

variable "ssh_public_key" {
  description = "Clé SSH publique injectée dans les VMs via cloud-init"
  type        = string
}

variable "vm_memory" {
  description = "Mémoire allouée à chaque VM (Mo)"
  type        = number
  default     = 1024
}

variable "vm_vcpu" {
  description = "Nombre de vCPU par VM"
  type        = number
  default     = 1
}

# Les trois VM du projet, avec leur IP fixe sur le réseau privé.
# Les clés servent aussi de hostname (utilisées par cloud-init).
variable "vms" {
  description = "Définition des machines virtuelles à créer"
  type        = map(object({ ip = string }))
  default = {
    "reverse-proxy" = { ip = "10.10.0.10" }
    "app"           = { ip = "10.10.0.20" }
    "db"            = { ip = "10.10.0.30" }
  }
}
