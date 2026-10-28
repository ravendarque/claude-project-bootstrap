resource "cloudflare_dns_record" "app_beta" {
  zone_id = data.cloudflare_zone.app.id
  name    = "beta.${var.app_zone_name}"
  type    = "A"
  content = "192.0.2.1"
  ttl     = 1
  proxied = true
  comment = "Placeholder so the beta hostname reaches the edge and the Worker route answers."

  lifecycle {
    prevent_destroy = true
  }
}
