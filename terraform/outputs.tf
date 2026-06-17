output "vm_adresses" {
  description = "Adresses IP des VMs déployées"
  value       = { for k, v in var.vms : k => v.ip }
}

output "url_application" {
  description = "URL d'accès public via le reverse proxy"
  value       = "http://${var.vms["reverse-proxy"].ip}/ (https en bonus)"
}
