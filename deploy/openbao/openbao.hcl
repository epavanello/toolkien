# OpenBao server for Toolkien. Never dev mode.
# The container only joins the internal `vault` network and publishes no port, so this
# listener is reachable from the app (and nothing on the internet).

ui            = false
log_level     = "info"

api_addr     = "http://openbao:8200"
cluster_addr = "https://openbao:8201"

storage "raft" {
  path    = "/openbao/data"
  node_id = "toolkien-openbao-1"
}

listener "tcp" {
  address         = "0.0.0.0:8200"
  cluster_address = "0.0.0.0:8201"
  # Plain HTTP on the internal network only (no published port). Put TLS here before ever
  # exposing the listener beyond `vault`.
  tls_disable = true
}

# Audit device: every request and response, sensitive values HMAC-hashed. Written to stdout
# so the container log collector keeps it.
audit "file" "stdout" {
  options {
    file_path = "stdout"
    log_raw   = "false"
  }
}
