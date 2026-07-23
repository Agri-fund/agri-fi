# CloudFront distribution fronting the Agri-fi platform.
#
# Two origins are wired up:
#   * An S3 bucket dedicated to immutable static assets (cached aggressively at
#     the edge via the managed CachingOptimized policy). It is locked down with
#     an Origin Access Control so the bucket itself stays private — only
#     CloudFront can read objects.
#   * The Next.js frontend behind the existing ALB (see ecs.tf). Dynamic /
#     server-rendered responses use the managed CachingDisabled policy so the
#     edge never serves stale HTML, while still terminating TLS and absorbing
#     connections at the edge.
#
# The KYC documents bucket (s3.tf) is intentionally NOT exposed through the CDN.

# Dedicated bucket for CDN-served static assets, kept private behind OAC.
resource "aws_s3_bucket" "static_assets" {
  bucket = "agrifi-static-assets"

  tags = {
    Name    = "agrifi-static-assets"
    Project = "agri-fi"
  }
}

resource "aws_s3_bucket_public_access_block" "static_assets" {
  bucket = aws_s3_bucket.static_assets.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "static_assets" {
  bucket = aws_s3_bucket.static_assets.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Origin Access Control lets CloudFront sign requests to the private S3 origin.
resource "aws_cloudfront_origin_access_control" "static_assets" {
  name                              = "agri-fi-static-assets-oac"
  description                       = "OAC for the Agri-fi static assets bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

locals {
  s3_origin_id  = "agri-fi-static-assets-s3"
  alb_origin_id = "agri-fi-nextjs-alb"

  # AWS managed cache / origin-request / response-header policy IDs.
  # https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-cache-policies.html
  cache_policy_caching_optimized    = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  cache_policy_caching_disabled     = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
  origin_request_all_viewer_no_host = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
  response_headers_security         = "67f7725c-6f97-4210-82d7-5512b31e9d03"
}

resource "aws_cloudfront_distribution" "agri_fi" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "Agri-fi platform CDN"
  price_class     = "PriceClass_100"
  aliases         = [var.domain_name, "www.${var.domain_name}"]

  # Static assets origin (private S3 bucket via OAC).
  origin {
    domain_name              = aws_s3_bucket.static_assets.bucket_regional_domain_name
    origin_id                = local.s3_origin_id
    origin_access_control_id = aws_cloudfront_origin_access_control.static_assets.id
  }

  # Next.js frontend origin (the ALB from ecs.tf).
  origin {
    domain_name = aws_lb.agri_fi.dns_name
    origin_id   = local.alb_origin_id

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  # Default behaviour: dynamic Next.js traffic — never cached at the edge.
  default_cache_behavior {
    target_origin_id           = local.alb_origin_id
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = local.cache_policy_caching_disabled
    origin_request_policy_id   = local.origin_request_all_viewer_no_host
    response_headers_policy_id = local.response_headers_security
  }

  # Next.js build output is content-hashed and immutable — cache it hard.
  ordered_cache_behavior {
    path_pattern           = "/_next/static/*"
    target_origin_id       = local.alb_origin_id
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = local.cache_policy_caching_optimized
  }

  # Static assets served straight from S3.
  ordered_cache_behavior {
    path_pattern           = "/static/*"
    target_origin_id       = local.s3_origin_id
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = local.cache_policy_caching_optimized
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # The ACM certificate (ecs.tf) must live in us-east-1 for CloudFront to use it.
  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate.agri_fi.arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  tags = {
    Name    = "agri-fi-cdn"
    Project = "agri-fi"
  }
}

# Allow the CloudFront distribution (and only it) to read static assets.
data "aws_iam_policy_document" "static_assets_oac" {
  statement {
    sid       = "AllowCloudFrontServicePrincipalReadOnly"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.static_assets.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.agri_fi.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "static_assets" {
  bucket = aws_s3_bucket.static_assets.id
  policy = data.aws_iam_policy_document.static_assets_oac.json
}

output "cloudfront_distribution_domain_name" {
  description = "Domain name of the CloudFront distribution (feed this into var.cloudfront_domain_name for dns.tf)."
  value       = aws_cloudfront_distribution.agri_fi.domain_name
}

output "cloudfront_distribution_id" {
  description = "ID of the CloudFront distribution."
  value       = aws_cloudfront_distribution.agri_fi.id
}
