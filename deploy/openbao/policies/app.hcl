# Policy of the Toolkien app (AppRole `toolkien-app`). Only the three transit operations on the
# workspace key, plus managing its own short-lived token. Nothing else: the app cannot read,
# export, rotate or delete keys.
path "transit/encrypt/toolkien-tokens" {
  capabilities = ["update"]
}
path "transit/decrypt/toolkien-tokens" {
  capabilities = ["update"]
}
path "transit/rewrap/toolkien-tokens" {
  capabilities = ["update"]
}

# Own token only (the `default` policy is not attached to app tokens)
path "auth/token/renew-self" {
  capabilities = ["update"]
}
path "auth/token/lookup-self" {
  capabilities = ["read"]
}
