# 입력 변수. 값은 terraform.tfvars(커밋 안 함)에 적는다. 예시는 terraform.tfvars.example.

variable "subscription_id" {
  description = "리소스를 만들 Azure 구독 ID"
  type        = string
  validation {
    condition     = can(regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", var.subscription_id))
    error_message = "subscription_id는 소문자 UUID 형식이어야 한다."
  }
}

variable "location" {
  description = "Azure 지역"
  type        = string
  default     = "koreacentral"
}

variable "name" {
  description = "리소스 이름에 붙는 이름. 리소스 그룹은 rg-<name>"
  type        = string
  default     = "charchat-demo"
  validation {
    condition     = can(regex("^[a-z0-9-]{3,20}$", var.name))
    error_message = "name은 소문자·숫자·하이픈 3~20자."
  }
}

variable "dns_label" {
  description = "공인 IP의 DNS 레이블. 주소는 <dns_label>.<location>.cloudapp.azure.com. 지역 안에서 유일해야 한다."
  type        = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,61}[a-z0-9]$", var.dns_label))
    error_message = "dns_label은 소문자로 시작하고 소문자·숫자·하이픈만 쓴다(3~63자)."
  }
}

variable "vm_size" {
  description = "VM 크기. 이미지 빌드를 VM에서 하므로 메모리 4GB를 권장한다."
  type        = string
  default     = "Standard_B2s"
  validation {
    condition     = startswith(var.vm_size, "Standard_B")
    error_message = "B 시리즈만 허용한다(비용 상한)."
  }
}

variable "os_disk_size_gb" {
  description = "OS 디스크 크기(GB). 이미지 빌드 캐시와 DB 볼륨이 여기에 들어간다."
  type        = number
  default     = 30
}

variable "admin_username" {
  description = "VM 관리자 계정 이름"
  type        = string
  default     = "demoadmin"
}

variable "ssh_public_key" {
  description = "VM에 넣을 SSH 공개키(한 줄). 비밀번호 로그인은 꺼져 있어 이 키로만 들어간다."
  type        = string
  validation {
    condition     = can(regex("^(ssh-ed25519|ssh-rsa) ", trimspace(var.ssh_public_key)))
    error_message = "ssh_public_key는 ssh-ed25519 또는 ssh-rsa 공개키여야 한다."
  }
}

variable "my_ip_cidr" {
  description = "SSH(22)를 허용할 내 공인 IP. /32로 적는다. IP가 바뀌면 이 값을 고쳐 다시 apply한다."
  type        = string
  validation {
    condition     = can(cidrhost(var.my_ip_cidr, 0)) && endswith(var.my_ip_cidr, "/32")
    error_message = "my_ip_cidr는 a.b.c.d/32 형식이어야 한다."
  }
}

variable "budget_amount" {
  description = "이 리소스 그룹의 월 예산. 단위는 구독의 청구 통화."
  type        = number
  validation {
    condition     = var.budget_amount > 0
    error_message = "budget_amount는 0보다 커야 한다."
  }
}

variable "budget_start_date" {
  description = "예산 집계 시작일. 이번 달 1일로 적는다. 바꾸면 예산이 다시 만들어진다."
  type        = string
  validation {
    condition     = can(regex("^[0-9]{4}-(0[1-9]|1[0-2])-01T00:00:00Z$", var.budget_start_date))
    error_message = "budget_start_date는 'YYYY-MM-01T00:00:00Z' 형식이어야 한다."
  }
}

variable "alert_emails" {
  description = "예산 알림을 받을 이메일 목록"
  type        = list(string)
  validation {
    condition     = length(var.alert_emails) > 0
    error_message = "alert_emails는 1개 이상이어야 한다."
  }
}
