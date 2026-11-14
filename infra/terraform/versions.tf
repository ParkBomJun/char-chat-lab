# Terraform과 프로바이더 버전을 고정한다(버전이 떠다니면 어제 되던 apply가 오늘 깨진다).
terraform {
  required_version = ">= 1.9.0, < 2.0.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.81" # 4.81 이상 5.0 미만
    }
  }
  # backend 블록이 없으므로 상태 파일은 이 폴더에 로컬로 남는다(커밋하지 않는다).
}

# 인증 정보는 여기에 없다. `az login`한 사용자 자격을 쓴다.
provider "azurerm" {
  subscription_id = var.subscription_id # 4.x는 구독을 명시해야 한다

  features {
    virtual_machine {
      delete_os_disk_on_deletion = true # VM을 지울 때 OS 디스크가 남아 과금되지 않게
    }
  }
}
