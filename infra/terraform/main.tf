# 공개 데모용 VM 한 대.
#   인터넷 ─443→ Caddy(자동 HTTPS) → app(3000) → db(내부 전용)   ※ 80은 443으로 넘김
# 만드는 것: 리소스 그룹, 가상 네트워크와 서브넷, NSG, 공인 IP(DNS 레이블), NIC, VM, 예산 알림.
# 끌 때는 `terraform destroy` 한 번이다. 자동 종료 스케줄은 넣지 않았다(데모는 아무 때나 열려야 한다).

locals {
  tags = { project = "char-chat-lab", purpose = "public-demo", managed_by = "terraform" }
}

resource "azurerm_resource_group" "demo" {
  name     = "rg-${var.name}"
  location = var.location
  tags     = local.tags
}

# ---------- 네트워크 ----------

resource "azurerm_virtual_network" "demo" {
  name                = "vnet-${var.name}"
  resource_group_name = azurerm_resource_group.demo.name
  location            = azurerm_resource_group.demo.location
  address_space       = ["10.20.0.0/16"]
  tags                = local.tags
}

resource "azurerm_subnet" "app" {
  name                 = "snet-app"
  resource_group_name  = azurerm_resource_group.demo.name
  virtual_network_name = azurerm_virtual_network.demo.name
  address_prefixes     = ["10.20.1.0/24"]
}

# 인바운드는 80·443(전체)과 22(내 IP)만 연다. 앱 포트 3000과 DB 5432는 열지 않는다.
resource "azurerm_network_security_group" "app" {
  name                = "nsg-${var.name}"
  resource_group_name = azurerm_resource_group.demo.name
  location            = azurerm_resource_group.demo.location
  tags                = local.tags
}

resource "azurerm_network_security_rule" "allow_ssh_from_my_ip" {
  name                        = "AllowSshFromMyIp"
  resource_group_name         = azurerm_resource_group.demo.name
  network_security_group_name = azurerm_network_security_group.app.name
  priority                    = 100
  direction                   = "Inbound"
  access                      = "Allow"
  protocol                    = "Tcp"
  source_port_range           = "*"
  destination_port_range      = "22"
  source_address_prefix       = var.my_ip_cidr
  destination_address_prefix  = "*"
}

# 80은 인증서 발급 확인과 443으로 넘기는 용도다.
resource "azurerm_network_security_rule" "allow_web" {
  name                        = "AllowHttpHttps"
  resource_group_name         = azurerm_resource_group.demo.name
  network_security_group_name = azurerm_network_security_group.app.name
  priority                    = 110
  direction                   = "Inbound"
  access                      = "Allow"
  protocol                    = "Tcp"
  source_port_range           = "*"
  destination_port_ranges     = ["80", "443"]
  source_address_prefix       = "Internet"
  destination_address_prefix  = "*"
}

# 기본 규칙(가상 네트워크 내부 허용 등)보다 앞에서 나머지를 막아, 열린 것이 위 두 규칙뿐임을 분명히 한다.
resource "azurerm_network_security_rule" "deny_all_inbound" {
  name                        = "DenyAllInbound"
  resource_group_name         = azurerm_resource_group.demo.name
  network_security_group_name = azurerm_network_security_group.app.name
  priority                    = 4096
  direction                   = "Inbound"
  access                      = "Deny"
  protocol                    = "*"
  source_port_range           = "*"
  destination_port_range      = "*"
  source_address_prefix       = "*"
  destination_address_prefix  = "*"
}

resource "azurerm_subnet_network_security_group_association" "app" {
  subnet_id                 = azurerm_subnet.app.id
  network_security_group_id = azurerm_network_security_group.app.id
}

# 고정 공인 IP와 DNS 레이블. 도메인을 사지 않고 <dns_label>.<location>.cloudapp.azure.com을 쓴다.
resource "azurerm_public_ip" "vm" {
  name                = "pip-${var.name}"
  resource_group_name = azurerm_resource_group.demo.name
  location            = azurerm_resource_group.demo.location
  sku                 = "Standard"
  allocation_method   = "Static"
  ip_version          = "IPv4"
  domain_name_label   = var.dns_label
  tags                = local.tags
}

resource "azurerm_network_interface" "vm" {
  name                = "nic-${var.name}"
  resource_group_name = azurerm_resource_group.demo.name
  location            = azurerm_resource_group.demo.location
  tags                = local.tags

  ip_configuration {
    name                          = "primary"
    subnet_id                     = azurerm_subnet.app.id
    private_ip_address_allocation = "Dynamic"
    public_ip_address_id          = azurerm_public_ip.vm.id
  }
}

# ---------- VM ----------

resource "azurerm_linux_virtual_machine" "app" {
  name                = "vm-${var.name}"
  computer_name       = "vm-${var.name}"
  resource_group_name = azurerm_resource_group.demo.name
  location            = azurerm_resource_group.demo.location
  size                = var.vm_size
  tags                = local.tags

  network_interface_ids = [azurerm_network_interface.vm.id]

  # SSH는 키 인증만. 비밀번호 로그인은 끈다.
  admin_username                  = var.admin_username
  disable_password_authentication = true
  admin_ssh_key {
    username   = var.admin_username
    public_key = trimspace(var.ssh_public_key)
  }

  os_disk {
    name                 = "osdisk-${var.name}"
    caching              = "ReadWrite"
    storage_account_type = "StandardSSD_LRS"
    disk_size_gb         = var.os_disk_size_gb
  }

  # Ubuntu 24.04 LTS (Gen2). latest는 만들 때의 최신 이미지를 고르고, 이후 새 이미지가 나와도 VM을 다시 만들지 않는다.
  source_image_reference {
    publisher = "Canonical"
    offer     = "ubuntu-24_04-lts"
    sku       = "server"
    version   = "latest"
  }

  secure_boot_enabled = true
  vtpm_enabled        = true

  # 첫 부팅 때 한 번 실행: Docker와 compose 플러그인 설치. 이 값을 바꾸면 VM이 디스크째 다시 만들어진다.
  custom_data = base64encode(templatefile("${path.module}/cloud-init.yaml", {
    admin_username = var.admin_username
  }))

  boot_diagnostics {} # SSH가 안 될 때 포털의 직렬 콘솔로 cloud-init 실패를 볼 수 있다
}

# ---------- 예산 알림 ----------
# 이 리소스 그룹에만 건다(구독에 이미 있는 예산은 건드리지 않는다). 알림일 뿐 차단이 아니다. 넘어도 Azure는 리소스를 멈추지 않는다.

resource "azurerm_consumption_budget_resource_group" "demo" {
  name              = "budget-${var.name}"
  resource_group_id = azurerm_resource_group.demo.id

  amount     = var.budget_amount
  time_grain = "Monthly"

  time_period {
    start_date = var.budget_start_date
  }

  dynamic "notification" {
    for_each = [50, 80, 100]
    content {
      enabled        = true
      threshold      = notification.value
      operator       = "GreaterThan"
      threshold_type = "Actual"
      contact_emails = var.alert_emails
    }
  }

  notification {
    enabled        = true
    threshold      = 100
    operator       = "GreaterThan"
    threshold_type = "Forecasted"
    contact_emails = var.alert_emails
  }
}
