# Migrations

The public tables are server-owned durable state. Supabase `anon` and
`authenticated` roles are revoked in migrations, and row-level security is
enabled without client policies.

Use only the server's service-role or otherwise least-privileged secret database
connection from trusted server code. Never expose that secret to browser code or
public clients.
