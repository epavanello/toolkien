# Policy of the backup job (AppRole `toolkien-backup`): raft snapshots only.
path "sys/storage/raft/snapshot" {
  capabilities = ["read"]
}
path "auth/token/revoke-self" {
  capabilities = ["update"]
}
