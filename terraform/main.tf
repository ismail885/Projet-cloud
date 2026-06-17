# ---------------------------------------------------------------------------
# Pool de stockage + image de base
# ---------------------------------------------------------------------------
resource "libvirt_pool" "cloud" {
  name = var.pool_name
  type = "dir"
  target {
    path = var.pool_path
  }
}

# Image cloud Debian 12 téléchargée une seule fois, utilisée comme base
resource "libvirt_volume" "base" {
  name   = "debian12-base.qcow2"
  pool   = libvirt_pool.cloud.name
  source = var.base_image_url
  format = "qcow2"
}

# Un disque par VM, dérivé (backing store) de l'image de base
resource "libvirt_volume" "disk" {
  for_each       = var.vms
  name           = "${each.key}.qcow2"
  pool           = libvirt_pool.cloud.name
  base_volume_id = libvirt_volume.base.id
  size           = 10 * 1024 * 1024 * 1024 # 10 Go
}

# ---------------------------------------------------------------------------
# Réseau privé NAT 10.10.0.0/24
# ---------------------------------------------------------------------------
resource "libvirt_network" "cloud_net" {
  name      = "cloud-net"
  mode      = "nat"
  domain    = "cloud.local"
  addresses = [var.network_cidr]
  dhcp {
    enabled = true
  }
  dns {
    enabled = true
  }
}

# ---------------------------------------------------------------------------
# cloud-init : un disque ISO par VM (user-data + network-config)
# ---------------------------------------------------------------------------
resource "libvirt_cloudinit_disk" "cloudinit" {
  for_each = var.vms
  name     = "${each.key}-cloudinit.iso"
  pool     = libvirt_pool.cloud.name

  user_data = templatefile("${path.module}/templates/user_data.yaml.tftpl", {
    hostname = each.key
    ssh_key  = var.ssh_public_key
  })

  network_config = templatefile("${path.module}/templates/network_config.yaml.tftpl", {
    ip      = each.value.ip
    gateway = cidrhost(var.network_cidr, 1)
  })
}

# ---------------------------------------------------------------------------
# Les machines virtuelles
# ---------------------------------------------------------------------------
resource "libvirt_domain" "vm" {
  for_each   = var.vms
  name       = each.key
  memory     = var.vm_memory
  vcpu       = var.vm_vcpu
  qemu_agent = true

  cloudinit = libvirt_cloudinit_disk.cloudinit[each.key].id

  network_interface {
    network_id     = libvirt_network.cloud_net.id
    wait_for_lease = false
  }

  disk {
    volume_id = libvirt_volume.disk[each.key].id
  }

  console {
    type        = "pty"
    target_port = "0"
    target_type = "serial"
  }

  graphics {
    type        = "vnc"
    listen_type = "address"
  }
}
