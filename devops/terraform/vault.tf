# Vault Provider Configuration
# Assuming Vault will be accessible at this address after deployment
provider "vault" {
  address = "http://${aws_instance.vault.public_ip}:8200"
  # token   = var.vault_token # Should be provided via environment variable
}

# KMS Key for Vault Auto-Unseal (Best practice for production)
resource "aws_kms_key" "vault" {
  description             = "Vault auto-unseal key"
  deletion_window_in_days = 10

  tags = {
    Name = "vault-kms-key"
  }
}

# IAM Role for Vault EC2 instance to use KMS for unsealing
resource "aws_iam_role" "vault" {
  name = "vault-server-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
      },
    ]
  })
}

resource "aws_iam_role_policy" "vault_kms" {
  name = "vault-kms-policy"
  role = aws_iam_role.vault.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = [
          "kms:DescribeKey",
          "kms:Encrypt",
          "kms:Decrypt"
        ]
        Effect   = "Allow"
        Resource = aws_kms_key.vault.arn
      },
    ]
  })
}

resource "aws_iam_instance_profile" "vault" {
  name = "vault-instance-profile"
  role = aws_iam_role.vault.name
}

# Security Group for Vault
resource "aws_security_group" "vault" {
  name        = "vault-sg"
  description = "Allow Vault traffic"

  ingress {
    from_port   = 8200
    to_port     = 8200
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"] # In production, restrict to internal network or specific IPs
  }

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# EC2 Instance for Vault
resource "aws_instance" "vault" {
  ami           = "ami-0c55b159cbfafe1f0" # Replace with a valid AMI for your region
  instance_type = "t3.micro"

  iam_instance_profile   = aws_iam_instance_profile.vault.name
  vpc_security_group_ids = [aws_security_group.vault.id]

  user_data = <<-EOF
              #!/bash
              # Basic Vault installation and configuration (example only)
              # In a real scenario, use a pre-built AMI or Ansible/Packer
              apt-get update && apt-get install -y unzip
              curl -fsSL https://apt.releases.hashicorp.com/gpg | apt-key add -
              apt-add-repository "deb [arch=amd64] https://apt.releases.hashicorp.com $(lsb_release -cs) main"
              apt-get update && apt-get install vault
              
              cat <<VCFG > /etc/vault.d/vault.hcl
              storage "file" {
                path = "/opt/vault/data"
              }
              listener "tcp" {
                address     = "0.0.0.0:8200"
                tls_disable = 1
              }
              seal "awskms" {
                region     = "us-east-1"
                kms_key_id = "${aws_kms_key.vault.key_id}"
              }
              VCFG
              
              systemctl enable vault
              systemctl start vault
              EOF

  tags = {
    Name = "vault-server"
  }
}

# --- Vault Configuration (Policies and Secret Engines) ---

# Enable KV Secret Engine (Version 2)
resource "vault_mount" "kvv2" {
  path        = "secret"
  type        = "kv-v2"
  description = "KV Version 2 secret engine for application secrets"
}

# Policy for Backend App to read Database and Stellar secrets
resource "vault_policy" "backend_app" {
  name = "backend-app-policy"

  policy = <<EOT
path "secret/data/backend/*" {
  capabilities = ["read"]
}
EOT
}

# Example of writing a placeholder secret for Database (to be updated manually)
resource "vault_generic_secret" "database_config" {
  path = "secret/backend/database"

  data_json = jsonencode({
    password = "change-me-manually"
  })

  depends_on = [vault_mount.kvv2]
}

# Example of writing a placeholder secret for Stellar API (to be updated manually)
resource "vault_generic_secret" "stellar_config" {
  path = "secret/backend/stellar"

  data_json = jsonencode({
    platform_secret = "change-me-manually"
  })

  depends_on = [vault_mount.kvv2]
}
