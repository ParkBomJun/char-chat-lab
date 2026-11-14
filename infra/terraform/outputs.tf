output "site_address" {
  description = "공개 주소. .env.production의 SITE_ADDRESS에 넣는다."
  value       = azurerm_public_ip.vm.fqdn
}

output "public_ip" {
  value = azurerm_public_ip.vm.ip_address
}

output "ssh_command" {
  description = "접속 명령(개인키 경로는 -i로 지정)"
  value       = "ssh ${var.admin_username}@${azurerm_public_ip.vm.fqdn}"
}

output "resource_group" {
  value = azurerm_resource_group.demo.name
}
